// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { memoryQuoteStore, redisQuoteStore, RELEASE_GRACE_MS, type Attempt, type QuoteStore, type QuoteRecord } from '../store';
import { hasRedis, startRedis } from '../../../handshake/__tests__/redis-fixture';
import { createOneClickService } from '../service';
import { createFixtureClient, createFixtureSigner } from '../fixture-client';
import { fixtureChain } from '../../chain';
import { fixtureRequests } from '@/lib/mainnet/fixtures';
import { BASE_USDC } from '@/lib/mainnet/oneclick/allowlist';
import { handleQuote, handleStatus } from '../http';
import { clientBucket, memoryRateLimit, redisRateLimit } from '../rate-limit';

const now = Date.UTC(2026, 10, 13, 12);
const id = 'a'.repeat(64);
const input = (mode: 'dry' | 'funded' = 'dry', requestId = id, ownerHash = 'owner-a') => ({ id: crypto.randomUUID(), requestId, mode, payload: '{"dry":true}', createdAtMs: now, deadlineMs: now + 20 * 60_000, ownerHash });
async function reserve(store: QuoteStore, mode: 'dry' | 'funded' = 'dry', ownerHash = 'owner-a') {
  const r = await store.reserve(input(mode, id, ownerHash), now);
  if (r.kind !== 'RESERVED') throw new Error(r.kind);
  return r.attempt;
}
const record = (a: Attempt, deadlineMs = now + 10 * 60_000): QuoteRecord => ({ requestId: a.requestId, mode: a.mode,
  correlationId: 'signed-id', originAssetId: BASE_USDC.assetId, refundTo: '0x1111111111111111111111111111111111111111',
  depositAddress: a.mode === 'funded' ? '0x2222222222222222222222222222222222222222' : null,
  depositMemo: null, deadlineMs, createdAtMs: now, amountIn: '1000001', amountInFormatted: '1.000001', minAmountIn: '1000000', amountOut: '1000000', timeEstimateSec: null, signedResponse: '{}' });
async function ready(store: QuoteStore, a: Attempt, deadlineMs?: number) {
  expect(await store.transition(a, 'DISPATCHING')).toBe(true);
  expect(await store.transition({ ...a, state: 'DISPATCHING' }, 'READY', record(a, deadlineMs))).toBe(true);
  return { ...a, state: 'READY' as const, record: record(a, deadlineMs) };
}
const LATER = 3 * 60 * 60_000;

function storeCases(create: () => Promise<{ store: QuoteStore; restart: () => QuoteStore; stop: () => Promise<void> }>) {
  it('admits exactly one of 20 concurrent reservations from 20 owners', async () => {
    const f = await create();
    try {
      const all = await Promise.all(Array.from({ length: 20 }, (_, i) => f.store.reserve(input('funded', id, `owner-${i}`), now)));
      expect(all.filter(r => r.kind === 'RESERVED')).toHaveLength(1);
      expect(all.filter(r => r.kind === 'BUSY')).toHaveLength(19);
      expect((await f.restart().attempts(id)).map(a => a.state)).toEqual(['RESERVED']);
    } finally { await f.stop(); }
  });
  it('fences stale writes and replays; the owner of a READY funded attempt gets it back, others are blocked', async () => {
    const f = await create();
    try {
      const a = await reserve(f.store, 'funded');
      expect(await f.store.transition(a, 'DISPATCHING')).toBe(true);
      expect(await f.store.transition(a, 'DISPATCHING')).toBe(false);
      const d = { ...a, state: 'DISPATCHING' as const };
      expect(await f.store.transition({ ...d, fence: 500 }, 'READY', record(a))).toBe(false);
      expect(await f.store.transition(d, 'READY', { ...record(a), deadlineMs: a.deadlineMs + 1 })).toBe(false);
      expect(await f.store.transition(d, 'READY', { ...record(a), requestId: 'b'.repeat(64) })).toBe(false);
      expect(await f.store.transition(d, 'READY', record(a))).toBe(true);
      expect(await f.store.transition(d, 'UNCERTAIN')).toBe(false);
      const mine = await f.restart().reserve({ ...input('funded'), createdAtMs: now + LATER }, now + LATER);
      expect(mine.kind === 'OWNED' && mine.attempt.id).toBe(a.id);
      const other = await f.restart().reserve(input('funded', id, 'owner-b'), now + 100 * 86_400_000);
      expect(other.kind === 'ACTIVE' && other.attempt.id).toBe(a.id);
    } finally { await f.stop(); }
  });
  it('a dry READY quote blocks only until its deadline; the lifetime cap holds', async () => {
    const f = await create();
    try {
      const a = await reserve(f.store);
      await ready(f.store, a);
      expect((await f.store.reserve(input('dry', id, 'owner-b'), now + 1)).kind).toBe('ACTIVE');
      const b = await f.store.reserve(input('dry', id, 'owner-b'), now + 11 * 60_000);
      expect(b.kind).toBe('RESERVED');
      if (b.kind !== 'RESERVED') return;
      expect(b.attempt.fence).toBe(2);
      await ready(f.store, b.attempt, now + 20 * 60_000);
      const c = await f.store.reserve({ ...input('dry', id, 'owner-c'), deadlineMs: now + 41 * 60_000 }, now + 21 * 60_000);
      if (c.kind !== 'RESERVED') throw new Error(c.kind);
      await ready(f.store, c.attempt, now + 22 * 60_000);
      expect((await f.store.reserve(input('dry', id, 'owner-d'), now + 23 * 60_000)).kind).toBe('LIMIT');
    } finally { await f.stop(); }
  });
  it.each(['RESERVED', 'DISPATCHING', 'UNCERTAIN'] as const)('a funded %s attempt (address never shown) survives restart and blocks until deadline + grace', async state => {
    const f = await create();
    try {
      const a = await reserve(f.store, 'funded');
      if (state !== 'RESERVED') await f.store.transition(a, 'DISPATCHING');
      if (state === 'UNCERTAIN') await f.store.transition({ ...a, state: 'DISPATCHING' }, 'UNCERTAIN');
      expect((await f.restart().attempts(id))[0]?.state).toBe(state);
      expect((await f.restart().reserve(input('funded', id, 'owner-b'), a.deadlineMs + RELEASE_GRACE_MS)).kind).toBe('BUSY');
      expect((await f.restart().reserve(input('funded', id, 'owner-a'), a.deadlineMs)).kind).toBe('BUSY');
      expect((await f.restart().reserve(input('funded', id, 'owner-b'), a.deadlineMs + RELEASE_GRACE_MS + 1)).kind).toBe('RESERVED');
    } finally { await f.stop(); }
  });
  it('a READY funded attempt never expires by time; release only after its deadline, once, then a new attempt', async () => {
    const f = await create();
    try {
      const a = await ready(f.store, await reserve(f.store, 'funded'));
      expect((await f.store.reserve(input('funded', id, 'owner-b'), now + 365 * 86_400_000)).kind).toBe('ACTIVE');
      expect(await f.store.release(a, a.record.deadlineMs, 'ORIGIN_REFUND_VERIFIED')).toBe(false);
      expect(await f.store.release({ ...a, fence: 9 }, a.record.deadlineMs + 1, 'ORIGIN_REFUND_VERIFIED')).toBe(false);
      expect(await f.store.release(a, a.record.deadlineMs + 1, 'ORIGIN_REFUND_VERIFIED')).toBe(true);
      expect(await f.store.release(a, a.record.deadlineMs + 2, 'ORIGIN_NO_DEPOSIT_VERIFIED')).toBe(false);
      const b = await f.restart().reserve(input('funded', id, 'owner-b'), a.record.deadlineMs + 2);
      expect(b.kind).toBe('RESERVED');
      if (b.kind !== 'RESERVED') return;
      // The released attempt cannot come back to life.
      expect(await f.store.transition(a, 'UNCERTAIN')).toBe(false);
      const list = await f.restart().attempts(id);
      expect(list.map(x => [x.fence, x.released?.reason ?? null])).toEqual([[1, 'ORIGIN_REFUND_VERIFIED'], [2, null]]);
    } finally { await f.stop(); }
  });
  it('two payable deposit addresses can never be READY at once (defence in depth)', async () => {
    const f = await create();
    try {
      const a = await ready(f.store, await reserve(f.store, 'funded'));
      await f.store.release(a, a.record.deadlineMs + 1, 'ORIGIN_NO_DEPOSIT_VERIFIED');
      const r = await f.store.reserve(input('funded', id, 'owner-b'), a.record.deadlineMs + 2);
      if (r.kind !== 'RESERVED') throw new Error(r.kind);
      expect(await f.store.transition(r.attempt, 'DISPATCHING')).toBe(true);
      expect(await f.store.transition({ ...r.attempt, state: 'DISPATCHING' }, 'READY', record(r.attempt))).toBe(true);
    } finally { await f.stop(); }
  });
}
describe('deterministic attempt state machine', () => storeCases(async () => {
  const store = memoryQuoteStore(); return { store, restart: () => store, stop: async () => {} };
}));
describe.skipIf(!hasRedis)('real Redis atomic ledger (worker restart)', () => storeCases(async () => {
  const r = await startRedis(); return { store: redisQuoteStore(r.cmd), restart: () => redisQuoteStore(r.cmd), stop: r.stop };
}));
it('CI must have real Redis available', () => { if (process.env['GITHUB_ACTIONS']) expect(hasRedis).toBe(true); });

function serviceSetup(store = memoryQuoteStore(), quote?: () => Promise<unknown>) {
  const signer = createFixtureSigner();
  const client = createFixtureClient(signer, () => now);
  const request = fixtureRequests(now).find(e => e.scenario.name === 'usdc-awaiting')!.request;
  const args = { requestId: request.terms.id, originAsset: BASE_USDC.assetId, refundTo: '0x1111111111111111111111111111111111111111', attemptSecret: 'S'.repeat(43) };
  const call = vi.fn(quote ?? (body => client.quote(body)));
  const deps = { mode: 'fixture' as const, chain: fixtureChain(() => now), store, client: { ...client, quote: call }, managerPublicKey: signer.publicKey, now: () => now };
  return { store, args, call, deps, service: createOneClickService(deps) };
}
it('persists dispatch before upstream; lost response is uncertain across service restart', async () => {
  const s = serviceSetup();
  s.call.mockImplementationOnce(async () => {
    expect((await s.store.attempts(s.args.requestId)).at(-1)?.state).toBe('DISPATCHING');
    throw new Error('connection lost after upstream accepted');
  });
  expect(await s.service.prepareQuote(s.args)).toEqual({ ok: false, code: 'ATTEMPT_UNCERTAIN' });
  expect((await s.store.attempts(s.args.requestId)).at(-1)?.state).toBe('UNCERTAIN');
  expect(await createOneClickService(s.deps).prepareQuote(s.args)).toEqual({ ok: false, code: 'ATTEMPT_UNCERTAIN' });
  expect(s.call).toHaveBeenCalledTimes(1);
});
it.each(['reserve', 'dispatch', 'ready-before-write', 'ready-after-write'] as const)('fails closed at persistence crash point %s', async point => {
  const underlying = memoryQuoteStore();
  const store: QuoteStore = { ...underlying,
    reserve: async (...args) => { const r = await underlying.reserve(...args); if (point === 'reserve') throw new Error('lost ack'); return r; },
    transition: async (a, state, r) => {
      if (state === 'READY' && point === 'ready-before-write') throw new Error('unavailable');
      const ok = await underlying.transition(a, state, r);
      if (state === 'DISPATCHING' && point === 'dispatch' || state === 'READY' && point === 'ready-after-write') throw new Error('lost ack');
      return ok;
    },
  };
  const s = serviceSetup(store);
  expect((await s.service.prepareQuote(s.args)).ok).toBe(false);
  const result = await createOneClickService({ ...s.deps, store: underlying }).prepareQuote(s.args);
  expect(result.ok).toBe(point === 'ready-after-write');
  expect(s.call).toHaveBeenCalledTimes(point.startsWith('ready') ? 1 : 0);
});
it('request-level rejection happens before any RPC', async () => {
  const s = serviceSetup(); const config = vi.fn(s.deps.chain.configProblems);
  const service = createOneClickService({ ...s.deps, chain: { ...s.deps.chain, configProblems: config }, rateLimit: async () => false });
  expect(await service.prepareQuote(s.args)).toEqual({ ok: false, code: 'RATE_LIMITED' });
  expect(config).not.toHaveBeenCalled(); expect(s.call).not.toHaveBeenCalled();
});

const request = (body: BodyInit) => new Request('https://mainnet.taplyapp.xyz/api/mainnet/oneclick/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
it('inbound UTF-8 byte cap is enforced without consuming an unbounded body', async () => {
  const service = vi.fn(); const cancel = vi.fn();
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('😀'.repeat(600))); }, cancel });
  expect((await handleQuote(request(body), service, true, async () => true)).status).toBe(413);
  expect(cancel).toHaveBeenCalled(); expect(service).not.toHaveBeenCalled();
});
it('inbound stalled body times out before service construction', async () => {
  vi.useFakeTimers();
  try {
    const service = vi.fn(); const cancel = vi.fn();
    const response = handleQuote(request(new ReadableStream({ cancel })), service, true, async () => true);
    await vi.advanceTimersByTimeAsync(2100);
    expect((await response).status).toBe(408); expect(cancel).toHaveBeenCalled(); expect(service).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it('IP/global denial and limiter failure stop quote/status before service work', async () => {
  const service = vi.fn();
  expect((await handleQuote(request('{}'), service, true, async () => false)).status).toBe(429);
  expect((await handleStatus(new Request('https://x/'), service, true, async () => false)).status).toBe(429);
  expect((await handleQuote(request('{}'), service, true, async () => { throw new Error('Redis down'); })).status).toBe(503);
  expect(service).not.toHaveBeenCalled();
});
it('untrusted forwarded headers cannot create fresh IP buckets', () => {
  const a = new Request('https://x', { headers: { 'x-forwarded-for': '1.2.3.4' } });
  const b = new Request('https://x', { headers: { 'x-forwarded-for': '5.6.7.8' } });
  expect(clientBucket(a, {})).toBe(clientBucket(b, {}));
  expect(clientBucket(a, { VERCEL: '1' })).not.toBe(clientBucket(b, { VERCEL: '1' }));
});
it('atomic limiter counts failures, isolates clients, and resets only after its window', async () => {
  let time = 0; const limit = memoryRateLimit(() => time);
  const a = [{ key: 'global', limit: 3 }, { key: 'ip:a', limit: 2 }];
  expect(await limit(a)).toBe(true); expect(await limit(a)).toBe(true); expect(await limit(a)).toBe(false);
  expect(await limit([{ key: 'global', limit: 3 }, { key: 'ip:b', limit: 2 }])).toBe(true);
  expect(await limit([{ key: 'global', limit: 3 }, { key: 'ip:c', limit: 2 }])).toBe(false);
  time = 60_001; expect(await limit(a)).toBe(true);
});
it.skipIf(!hasRedis)('real Redis global quota is atomic across independent clients', async () => {
  const r = await startRedis();
  try {
    const results = await Promise.all(Array.from({ length: 30 }, () => redisRateLimit(r.cmd)([{ key: 'global', limit: 5 }])));
    expect(results.filter(Boolean)).toHaveLength(5);
  } finally { await r.stop(); }
});
