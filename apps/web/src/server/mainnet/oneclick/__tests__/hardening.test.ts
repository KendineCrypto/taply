// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { memoryQuoteStore, redisQuoteStore, type Attempt, type QuoteStore, type QuoteRecord } from '../store';
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
const input = (mode: 'dry' | 'funded' = 'dry', requestId = id) => ({ id: crypto.randomUUID(), requestId, mode, payload: '{"dry":true}', createdAtMs: now });
async function reserve(store: QuoteStore, mode: 'dry' | 'funded' = 'dry') {
  const a = await store.reserve(input(mode), null);
  if (typeof a === 'string') throw new Error(a);
  return a;
}
const record = (a: Attempt): QuoteRecord => ({ requestId: a.requestId, mode: a.mode,
  correlationId: 'signed-id', originAssetId: BASE_USDC.assetId, refundTo: '0x1111111111111111111111111111111111111111',
  depositAddress: a.mode === 'funded' ? '0x2222222222222222222222222222222222222222' : null,
  depositMemo: null, deadlineMs: now - 1, createdAtMs: now, amountIn: '1000001', amountInFormatted: '1.000001', minAmountIn: '1000000', amountOut: '1000000', timeEstimateSec: null, signedResponse: '{}' });

function storeCases(create: () => Promise<{ store: QuoteStore; restart: () => QuoteStore; stop: () => Promise<void> }>) {
  it('admits exactly one of 20 concurrent reservations, with no timed takeover', async () => {
    const f = await create();
    try {
      const all = await Promise.all(Array.from({ length: 20 }, () => f.store.reserve(input(), null)));
      const winners = all.filter(a => typeof a !== 'string');
      expect(winners).toHaveLength(1);
      const active = winners[0]!;
      expect(await f.restart().reserve({ ...input(), createdAtMs: now + 100 * 86_400_000 }, active.id)).toBe('BUSY');
      expect((await f.restart().current(id))?.state).toBe('RESERVED');
    } finally { await f.stop(); }
  });
  it('fences stale writes, rejects replay, and archives a completed dry attempt on replacement', async () => {
    const f = await create();
    try {
      const a = await reserve(f.store);
      expect(await f.store.transition(a, 'DISPATCHING')).toBe(true);
      expect(await f.store.transition(a, 'DISPATCHING')).toBe(false);
      const d = { ...a, state: 'DISPATCHING' as const };
      expect(await f.store.transition({ ...d, fence: 500 }, 'READY', record(a))).toBe(false);
      expect(await f.store.transition(d, 'READY', record(a))).toBe(true);
      const b = await f.restart().reserve(input(), a.id);
      expect(typeof b).toBe('object');
      expect(typeof b !== 'string' && b.fence).toBe(2);
      expect(await f.store.transition(d, 'UNCERTAIN')).toBe(false);
      expect(await f.store.reserve(input(), a.id)).toBe('BUSY');
    } finally { await f.stop(); }
  });
  it.each(['DISPATCHING', 'UNCERTAIN', 'READY'] as const)('funded %s survives a worker restart and never expires into another quote', async state => {
    const f = await create();
    try {
      const a = await reserve(f.store, 'funded');
      await f.store.transition(a, 'DISPATCHING');
      if (state !== 'DISPATCHING') await f.store.transition({ ...a, state: 'DISPATCHING' }, state, state === 'READY' ? record(a) : undefined);
      expect((await f.restart().current(id))?.state).toBe(state);
      expect(await f.restart().reserve({ ...input('funded'), createdAtMs: now + 999_999_999 }, a.id)).toBe('BUSY');
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
  const args = { requestId: request.terms.id, originAsset: BASE_USDC.assetId, refundTo: '0x1111111111111111111111111111111111111111' };
  const call = vi.fn(quote ?? (body => client.quote(body)));
  const deps = { mode: 'fixture' as const, chain: fixtureChain(() => now), store, client: { ...client, quote: call }, managerPublicKey: signer.publicKey, now: () => now };
  return { store, args, call, deps, service: createOneClickService(deps) };
}
it('persists dispatch before upstream; lost response is uncertain across service restart', async () => {
  const s = serviceSetup();
  s.call.mockImplementationOnce(async () => {
    expect((await s.store.current(s.args.requestId))?.state).toBe('DISPATCHING');
    throw new Error('connection lost after upstream accepted');
  });
  expect(await s.service.prepareQuote(s.args)).toEqual({ ok: false, code: 'ATTEMPT_UNCERTAIN' });
  expect((await s.store.current(s.args.requestId))?.state).toBe('UNCERTAIN');
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
