import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractRequestSchema } from '@/lib/protocol';
import paidRestricted from '@/test/fixtures/sandbox/paid-restricted.json';
import { createFetchLocatorRpc, createFetchVerifierRpc, immutableCacheKey, VerifierRpcError } from '../rpc';
import type { VerifierMethod } from '../rpc';
import {
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  MAX_RATE_LIMIT_COOLDOWN_MS,
  NETWORK_BACKOFF_MAX_MS,
  NETWORK_BACKOFF_START_MS,
  createRateLimitGate,
  parseRetryAfterMs,
} from '../rate-limit';
import { verifyInstantReceipt } from '../instant-receipt';
import type { VerificationResult } from '../instant-receipt';
import { AUTO_RETRY_DELAYS_MS, MAX_AUTO_WAIT_MS, nextAutoRetryDelay } from '../retry-policy';
import { ARCHIVED_VERIFICATIONS, archivedVerificationFor } from '../archive';
import { buildPaidChain, fakeRpc, receipts, txJson } from './fake-chain';

/**
 * Fault injection for the read-only verifier transport (Phase C, Monday sprint).
 * Every RPC answer here is SYNTHETIC. These tests prove failure handling, not
 * chain facts.
 */

const PAID = ContractRequestSchema.parse(paidRestricted);
const T0 = Date.parse('2026-11-07T12:00:00.000Z');

type Call = { method: VerifierMethod; params: unknown };

function clock(start = T0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

/** HTTP fetcher in front of the in-memory fake chain, with an injectable fault per call. */
function httpChain(
  ctx: ReturnType<typeof buildPaidChain>,
  fault: (call: Call, index: number) => Response | 'hang' | null = () => null,
) {
  const calls: Call[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: string; method: VerifierMethod; params: unknown };
    const call = { method: body.method, params: body.params };
    calls.push(call);
    const injected = fault(call, calls.length - 1);
    if (injected === 'hang') return new Promise<Response>(() => undefined);
    if (injected !== null) return injected;
    try {
      const result = await fakeRpc(ctx.chain).call(body.method, body.params);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    } catch (error) {
      const name = error instanceof VerifierRpcError && error.code === 'UNKNOWN_BLOCK' ? 'UNKNOWN_BLOCK' : 'UNKNOWN_TRANSACTION';
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, name: 'HANDLER_ERROR', cause: { name } } }));
    }
  }) as typeof fetch;
  return { fetcher, calls };
}

const tooMany = (retryAfter?: string) =>
  new Response('Too Many Requests', { status: 429, headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter } });

function reason(result: VerificationResult): string {
  return result.kind === 'verified' ? 'verified' : result.reason;
}

describe('Retry-After parsing', () => {
  it('reads delay-seconds and HTTP-dates, and rejects junk', () => {
    expect(parseRetryAfterMs('120', T0)).toBe(120_000);
    expect(parseRetryAfterMs(new Date(T0 + 45_000).toUTCString(), T0)).toBe(45_000);
    expect(parseRetryAfterMs(new Date(T0 - 45_000).toUTCString(), T0)).toBe(0);
    for (const junk of [null, undefined, '', '  ', '-5', '1.5', 'soon', '99999999999']) {
      expect(parseRetryAfterMs(junk, T0)).toBeNull();
    }
  });
});

describe('HTTP 429 handling', () => {
  it('maps 429 to RATE_LIMITED with the provider wait, and sends nothing during the cool-down', async () => {
    const c = clock();
    let hits = 0;
    const fetcher = (async (_u: string | URL | Request, init?: RequestInit) => {
      hits += 1;
      if (hits === 1) return tooMany('120');
      const { id } = JSON.parse(String(init?.body)) as { id: string };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } }));
    }) as typeof fetch;
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher, now: c.now, rateLimitGate: createRateLimitGate(c.now) });

    const first = await rpc.call('status', []).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(VerifierRpcError);
    expect((first as VerifierRpcError).code).toBe('RATE_LIMITED');
    expect((first as VerifierRpcError).retryAfterMs).toBe(120_000);

    c.advance(60_000);
    const during = await rpc.call('status', []).catch((e: unknown) => e);
    expect((during as VerifierRpcError).code).toBe('RATE_LIMITED');
    expect((during as VerifierRpcError).retryAfterMs).toBe(60_000);
    expect(hits).toBe(1); // no network call inside the cool-down

    c.advance(60_001);
    await expect(rpc.call('status', [])).resolves.toEqual({ ok: true });
    expect(hits).toBe(2);
  });

  it('uses a default cool-down without Retry-After and caps very long ones', async () => {
    for (const [header, expected] of [
      [undefined, DEFAULT_RATE_LIMIT_COOLDOWN_MS],
      ['418', 418_000],
      ['86400', MAX_RATE_LIMIT_COOLDOWN_MS],
      ['0', 2_000],
    ] as const) {
      const c = clock();
      const rpc = createFetchVerifierRpc({
        rpcUrl: 'https://rpc.example',
        providerId: 'p',
        fetcher: (async () => tooMany(header)) as typeof fetch,
        now: c.now,
        rateLimitGate: createRateLimitGate(c.now),
      });
      const error = (await rpc.call('status', []).catch((e: unknown) => e)) as VerifierRpcError;
      expect([header, error.code, error.retryAfterMs]).toEqual([header, 'RATE_LIMITED', expected]);
    }
  });

  it('one 429 pauses every reader that shares the gate (verifier and locator)', async () => {
    const c = clock();
    const gate = createRateLimitGate(c.now);
    let locatorHits = 0;
    const verifier = createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher: (async () => tooMany('30')) as typeof fetch,
      now: c.now,
      rateLimitGate: gate,
    });
    const locator = createFetchLocatorRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher: (async () => {
        locatorHits += 1;
        return new Response('{}');
      }) as typeof fetch,
      now: c.now,
      rateLimitGate: gate,
    });
    await verifier.call('status', []).catch(() => undefined);
    const error = (await locator.call('block', { finality: 'final' }).catch((e: unknown) => e)) as VerifierRpcError;
    expect(error.code).toBe('RATE_LIMITED');
    expect(locatorHits).toBe(0);
  });

  it('a 503 with Retry-After is unavailable, but its wait is honoured too', async () => {
    const c = clock();
    const gate = createRateLimitGate(c.now);
    const rpc = createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher: (async () => new Response('', { status: 503, headers: { 'retry-after': '20' } })) as typeof fetch,
      now: c.now,
      rateLimitGate: gate,
    });
    const error = (await rpc.call('status', []).catch((e: unknown) => e)) as VerifierRpcError;
    expect([error.code, error.retryAfterMs]).toEqual(['RPC_UNAVAILABLE', 20_000]);
    expect(gate.remainingMs()).toBe(20_000);
  });

  it('a later, shorter Retry-After never shortens an existing cool-down', () => {
    const c = clock();
    const gate = createRateLimitGate(c.now);
    gate.note(120_000);
    gate.note(5_000);
    expect(gate.remainingMs()).toBe(120_000);
  });
});

describe('opaque network failures (a 429 the browser may hide)', () => {
  it('backs off after each failure, doubling, without calling it a rate limit, and resets on success', async () => {
    const c = clock();
    let hits = 0;
    let fail = true;
    const fetcher = (async (_u: string | URL | Request, init?: RequestInit) => {
      hits += 1;
      // What a browser reports for a CORS-less 429: a TypeError, no status.
      if (fail) throw new TypeError('NetworkError when attempting to fetch resource.');
      const { id } = JSON.parse(String(init?.body)) as { id: string };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: {} }));
    }) as typeof fetch;
    const gate = createRateLimitGate(c.now);
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher, now: c.now, rateLimitGate: gate });
    const code = async () => ((await rpc.call('status', []).catch((e: unknown) => e)) as VerifierRpcError).code;

    expect(await code()).toBe('RPC_UNAVAILABLE');
    expect(gate.backoffRemainingMs()).toBe(NETWORK_BACKOFF_START_MS);
    expect(await code()).toBe('RPC_UNAVAILABLE'); // fails fast
    expect(hits).toBe(1);
    c.advance(NETWORK_BACKOFF_START_MS);
    expect(await code()).toBe('RPC_UNAVAILABLE');
    expect(gate.backoffRemainingMs()).toBe(NETWORK_BACKOFF_START_MS * 2);
    for (let i = 0; i < 12; i++) {
      c.advance(gate.backoffRemainingMs());
      await code();
    }
    expect(gate.backoffRemainingMs()).toBe(NETWORK_BACKOFF_MAX_MS);
    expect(gate.remainingMs()).toBe(0); // never invented a provider cool-down

    fail = false;
    c.advance(gate.backoffRemainingMs());
    await expect(rpc.call('status', [])).resolves.toEqual({});
    expect(gate.backoffRemainingMs()).toBe(0);
  });
});

describe('immutable answer cache', () => {
  it('keys only reads that can never change', () => {
    const hash = 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su';
    expect(immutableCacheKey('block', { block_id: hash })).not.toBeNull();
    expect(immutableCacheKey('chunk', { chunk_id: hash })).not.toBeNull();
    expect(immutableCacheKey('query', { request_type: 'view_account', account_id: 'a.testnet', block_id: hash })).not.toBeNull();
    expect(immutableCacheKey('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: 'a.testnet', wait_until: 'FINAL' })).not.toBeNull();

    expect(immutableCacheKey('status', [])).toBeNull();
    expect(immutableCacheKey('block', { finality: 'final' })).toBeNull();
    expect(immutableCacheKey('block', { block_id: 275767733 })).toBeNull(); // heights are not hashes
    expect(immutableCacheKey('query', { request_type: 'view_account', account_id: 'a.testnet', finality: 'final' })).toBeNull();
    expect(immutableCacheKey('query', { request_type: 'view_account', account_id: 'a.testnet', block_id: hash, finality: 'final' })).toBeNull();
    expect(immutableCacheKey('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: 'a.testnet', wait_until: 'EXECUTED' })).toBeNull();
    expect(immutableCacheKey('block', { block_id: 'not a hash' })).toBeNull();
  });

  it('serves a repeated immutable read from memory, as a copy that callers cannot poison', async () => {
    let hits = 0;
    const fetcher = (async (_u: string | URL | Request, init?: RequestInit) => {
      hits += 1;
      const { id } = JSON.parse(String(init?.body)) as { id: string };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { header: { height: 7 } } }));
    }) as typeof fetch;
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher });
    const params = { block_id: 'AKxg24GCGyreEARGfASH34D2xqDo6oAYQxKS28Cg8d6w' };
    const first = (await rpc.call('block', params)) as { header: { height: number } };
    first.header.height = 999;
    const second = (await rpc.call('block', params)) as { header: { height: number } };
    expect(second.header.height).toBe(7);
    expect(hits).toBe(1);
    await rpc.call('block', { finality: 'final' });
    await rpc.call('block', { finality: 'final' });
    expect(hits).toBe(3); // latest-final reads always go to the network
  });

  it('never caches errors, nulls or a non-FINAL transaction status', async () => {
    let hits = 0;
    const answers = [
      { error: { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION' } } },
      { result: { final_execution_status: 'EXECUTED_OPTIMISTIC' } },
      { result: { final_execution_status: 'FINAL' } },
    ];
    const fetcher = (async (_u: string | URL | Request, init?: RequestInit) => {
      const { id } = JSON.parse(String(init?.body)) as { id: string };
      const answer = answers[Math.min(hits, answers.length - 1)];
      hits += 1;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, ...answer }));
    }) as typeof fetch;
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher });
    const params = { tx_hash: 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su', sender_account_id: 'a.testnet', wait_until: 'FINAL' };
    await expect(rpc.call('EXPERIMENTAL_tx_status', params)).rejects.toMatchObject({ code: 'UNKNOWN_TRANSACTION' });
    await expect(rpc.call('EXPERIMENTAL_tx_status', params)).resolves.toMatchObject({ final_execution_status: 'EXECUTED_OPTIMISTIC' });
    await expect(rpc.call('EXPERIMENTAL_tx_status', params)).resolves.toMatchObject({ final_execution_status: 'FINAL' });
    await rpc.call('EXPERIMENTAL_tx_status', params);
    expect(hits).toBe(3);
  });
});

describe('verifier under injected faults', () => {
  const verifierWith = (ctx: ReturnType<typeof buildPaidChain>, fetcher: typeof fetch, c = clock()) =>
    createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'fault-http', fetcher, now: c.now, rateLimitGate: createRateLimitGate(c.now), timeoutMs: 200 });

  it('a 429 in the middle is RATE_LIMITED (transient, with wait), never a mismatch; the re-check refetches only what is missing', async () => {
    const ctx = buildPaidChain(PAID);
    const c = clock();
    let limited = true;
    const { fetcher, calls } = httpChain(ctx, (call) => (limited && call.method === 'EXPERIMENTAL_tx_status' ? tooMany('10') : null));
    const rpc = verifierWith(ctx, fetcher, c);

    const first = await verifyInstantReceipt({ ...ctx.input, rpc });
    expect(first).toMatchObject({ kind: 'not_verified', reason: 'RATE_LIMITED', transient: true, retryAfterMs: 10_000 });
    const firstQueries = calls.filter((x) => x.method === 'query').length;
    expect(firstQueries).toBeGreaterThan(0);

    // Inside the cool-down: fails at once, no network traffic.
    const before = calls.length;
    expect(reason(await verifyInstantReceipt({ ...ctx.input, rpc }))).toBe('RATE_LIMITED');
    expect(calls.length).toBe(before);

    limited = false;
    c.advance(10_001);
    const mark = calls.length;
    const second = await verifyInstantReceipt({ ...ctx.input, rpc });
    expect(reason(second)).toBe('verified');
    const again = calls.slice(mark);
    // Fresh every time: network identity and the latest final block.
    expect(again.filter((x) => x.method === 'status')).toHaveLength(1);
    expect(again.filter((x) => x.method === 'block' && (x.params as Record<string, unknown>)['finality'] === 'final')).toHaveLength(1);
    // The state-block code-hash and get_request answers from the first run were not asked again
    // (the access-key read at the state block was never reached before the 429, so it is new).
    const repeatedStateQueries = again.filter(
      (x) =>
        x.method === 'query' &&
        (x.params as Record<string, unknown>)['block_id'] === ctx.chain.final.hash &&
        (x.params as Record<string, unknown>)['request_type'] !== 'view_access_key_list',
    );
    expect(repeatedStateQueries).toHaveLength(0);
  });

  it('the cache never skips the network check: a provider that switches network is refused', async () => {
    const ctx = buildPaidChain(PAID);
    const { fetcher } = httpChain(ctx);
    const rpc = verifierWith(ctx, fetcher);
    expect(reason(await verifyInstantReceipt({ ...ctx.input, rpc }))).toBe('verified');
    ctx.chain.status = { ...ctx.chain.status, chain_id: 'mainnet', genesis_hash: 'EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H' };
    const result = await verifyInstantReceipt({ ...ctx.input, rpc });
    expect(result).toMatchObject({ kind: 'not_verified', reason: 'NETWORK_MISMATCH', transient: false });
  });

  it('the cache never replaces current state: a later final block with different state is read fresh', async () => {
    const ctx = buildPaidChain(PAID);
    const { fetcher } = httpChain(ctx);
    const rpc = verifierWith(ctx, fetcher);
    expect(reason(await verifyInstantReceipt({ ...ctx.input, rpc }))).toBe('verified');
    const next = { ...ctx.chain.final, hash: 'Ex5DkzLb7M7hrhEEhAW7VQVtmM4Nhsz8j4CH3nUkS9US', prevHash: ctx.chain.final.hash, height: ctx.chain.final.height + 1 };
    ctx.chain.blocks.set(next.hash, next);
    ctx.chain.final = next;
    ctx.chain.state = { ...(ctx.chain.state as Record<string, unknown>), status: 'PAYOUT_IN_FLIGHT' };
    expect(reason(await verifyInstantReceipt({ ...ctx.input, rpc }))).not.toBe('verified');
  });

  it('a timeout is uncertain (RPC_UNAVAILABLE, transient), never pruning and never success', async () => {
    const ctx = buildPaidChain(PAID);
    const { fetcher } = httpChain(ctx, (call) => (call.method === 'EXPERIMENTAL_tx_status' ? 'hang' : null));
    const result = await verifyInstantReceipt({ ...ctx.input, rpc: verifierWith(ctx, fetcher) });
    expect(result).toMatchObject({ kind: 'not_verified', reason: 'RPC_UNAVAILABLE', transient: true });
  });

  it('a truncated or non-JSON receipt body is evidence-inconsistent, not transient', async () => {
    const ctx = buildPaidChain(PAID);
    const { fetcher } = httpChain(ctx, (call) =>
      call.method === 'EXPERIMENTAL_tx_status' ? new Response('{"jsonrpc":"2.0","id":"taply-verify-5","result":{"receipts_outcome":[') : null,
    );
    const result = await verifyInstantReceipt({ ...ctx.input, rpc: verifierWith(ctx, fetcher) });
    expect(result).toMatchObject({ kind: 'not_verified', reason: 'EVIDENCE_INCONSISTENT', transient: false });
  });

  it('a JSON-RPC answer with another request id (crossed or replayed response) is refused', async () => {
    const ctx = buildPaidChain(PAID);
    const { fetcher } = httpChain(ctx, (call) =>
      call.method === 'status' ? new Response(JSON.stringify({ jsonrpc: '2.0', id: 'taply-verify-999', result: ctx.chain.status })) : null,
    );
    expect(reason(await verifyInstantReceipt({ ...ctx.input, rpc: verifierWith(ctx, fetcher) }))).toBe('EVIDENCE_INCONSISTENT');
  });

  it('a receipt history missing the callback cannot verify', async () => {
    const ctx = buildPaidChain(PAID);
    const tx = txJson(ctx.chain, ctx.input.fundingTransaction.hash);
    const rs = receipts(tx);
    const callbackIndex = rs.findIndex((r) => JSON.stringify(r).includes('on_native_transfer_complete'));
    expect(callbackIndex).toBeGreaterThanOrEqual(0);
    rs.splice(callbackIndex, 1);
    const { fetcher } = httpChain(ctx);
    const result = await verifyInstantReceipt({ ...ctx.input, rpc: verifierWith(ctx, fetcher) });
    expect(result.kind).toBe('not_verified');
    expect(result.kind === 'not_verified' && result.transient).toBe(false);
  });

  it('contradictory answers (state not anchored to the requested block) are refused', async () => {
    const ctx = buildPaidChain(PAID);
    const { fetcher } = httpChain(ctx);
    const base = verifierWith(ctx, fetcher);
    const rpc = {
      providerId: base.providerId,
      async call(method: VerifierMethod, params: unknown) {
        const result = await base.call(method, params);
        const p = params as Record<string, unknown>;
        if (method === 'query' && p['method_name'] === 'get_request') {
          return { ...(result as Record<string, unknown>), block_hash: '5bDG3t4Q2KC8b9SxFxd8yLxwcgCFV91mX4pMC27dSeK2' };
        }
        return result;
      },
    };
    expect(reason(await verifyInstantReceipt({ ...ctx.input, rpc }))).toBe('EVIDENCE_INCONSISTENT');
  });

  it('a wrong-network provider is refused before any receipt is read', async () => {
    const ctx = buildPaidChain(PAID);
    ctx.chain.status = { ...ctx.chain.status, chain_id: 'mainnet' };
    const { fetcher, calls } = httpChain(ctx);
    const result = await verifyInstantReceipt({ ...ctx.input, rpc: verifierWith(ctx, fetcher) });
    expect(result).toMatchObject({ reason: 'NETWORK_MISMATCH', transient: false });
    expect(calls.some((x) => x.method === 'EXPERIMENTAL_tx_status')).toBe(false);
  });
});

describe('automatic re-check schedule', () => {
  it('is bounded and backs off', () => {
    const transient = { reason: 'RPC_UNAVAILABLE' as const, transient: true };
    expect(AUTO_RETRY_DELAYS_MS.map((_, i) => nextAutoRetryDelay(transient, i))).toEqual([...AUTO_RETRY_DELAYS_MS]);
    expect(nextAutoRetryDelay(transient, AUTO_RETRY_DELAYS_MS.length)).toBeNull();
  });

  it('never auto-retries a non-transient result', () => {
    for (const r of ['CODE_HASH_MISMATCH', 'HISTORY_UNAVAILABLE', 'NETWORK_MISMATCH', 'EVIDENCE_INCONSISTENT'] as const) {
      expect(nextAutoRetryDelay({ reason: r, transient: false }, 0)).toBeNull();
    }
  });

  it('honours Retry-After, and leaves long waits to the person', () => {
    expect(nextAutoRetryDelay({ reason: 'RATE_LIMITED', transient: true, retryAfterMs: 20_000 }, 0)).toBe(20_000);
    expect(nextAutoRetryDelay({ reason: 'RATE_LIMITED', transient: true, retryAfterMs: 500 }, 0)).toBe(AUTO_RETRY_DELAYS_MS[0]);
    expect(nextAutoRetryDelay({ reason: 'RATE_LIMITED', transient: true, retryAfterMs: MAX_AUTO_WAIT_MS + 1 }, 0)).toBeNull();
    expect(nextAutoRetryDelay({ reason: 'RATE_LIMITED', transient: true, retryAfterMs: 418_000 }, 0)).toBeNull();
    expect(nextAutoRetryDelay({ reason: 'RATE_LIMITED', transient: true }, 0)).toBeNull();
  });
});

describe('archived verification record', () => {
  // Vitest runs from apps/web (like the other fixture readers here).
  const docsJson = '../../docs/evidence/instant-pay-2026-11-01-receipt.json';
  const publicJson = 'public/evidence/instant-pay-2026-11-01-receipt.json';

  it('serves a byte-identical copy of the docs evidence, and the summary matches it', () => {
    const docs = readFileSync(docsJson);
    expect(readFileSync(publicJson).equals(docs)).toBe(true);
    type Archived = {
      requestId: string; termsHash: string; contractId: string; contractCodeHash: string; network: string;
      amountBaseUnits: string; payerAccountId: string; recipientAccountId: string; finalStatus: string;
      fundingTransaction: { hash: string }; contractStateBlock: { height: string };
      verification: { rpcProviderId: string; checkedAt: string; state: string };
    };
    const json = JSON.parse(docs.toString('utf8')) as Archived;
    const record = ARCHIVED_VERIFICATIONS[0];
    expect(record).toEqual({
      requestId: json['requestId'],
      termsHash: json['termsHash'],
      contractId: json['contractId'],
      contractCodeHash: json['contractCodeHash'],
      network: json['network'],
      amountBaseUnits: json['amountBaseUnits'],
      payerAccountId: json['payerAccountId'],
      recipientAccountId: json['recipientAccountId'],
      fundingTransactionHash: json['fundingTransaction']['hash'],
      stateBlockHeight: json['contractStateBlock']['height'],
      rpcProviderId: json['verification']['rpcProviderId'],
      checkedAt: json['verification']['checkedAt'],
      jsonPath: '/evidence/instant-pay-2026-11-01-receipt.json',
    });
    expect(json['finalStatus']).toBe('FINAL_PAID');
    expect(json['verification']['state']).toBe('verified_final');
  });

  it('is offered only for the same contract, approved code and terms', () => {
    const r = ARCHIVED_VERIFICATIONS[0]!;
    const base = { requestId: r.requestId, contractId: r.contractId, approvedCodeHash: r.contractCodeHash, liveTermsHash: r.termsHash };
    expect(archivedVerificationFor(base)).toBe(r);
    expect(archivedVerificationFor({ ...base, liveTermsHash: null })).toBe(r);
    expect(archivedVerificationFor({ ...base, liveTermsHash: 'f'.repeat(64) })).toBeNull();
    expect(archivedVerificationFor({ ...base, contractId: 'other.testnet' })).toBeNull();
    expect(archivedVerificationFor({ ...base, approvedCodeHash: '11111111111111111111111111111111' })).toBeNull();
    expect(archivedVerificationFor({ ...base, requestId: 'a'.repeat(64) })).toBeNull();
  });
});
