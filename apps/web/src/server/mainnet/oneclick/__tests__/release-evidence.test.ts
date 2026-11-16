// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Funded path only inside this test module; the shipped gate is unchanged.
vi.mock('@/lib/mainnet/release-gates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED: true,
}));

import { fixtureRequests, FIXTURE_CONTRACT } from '@/lib/mainnet/fixtures';
import type { MainnetRequest } from '@/lib/mainnet/fixtures';
import { BASE_USDC } from '@/lib/mainnet/oneclick/allowlist';
import type { ChainView } from '../../chain';
import type { OneClickClient } from '../client';
import { createFixtureSigner, fixtureQuoteResponse } from '../fixture-client';
import { BASE_USDC_CONTRACT, TRANSFER_TOPIC, OriginRpcError, proveNoDeposit, proveRefund } from '../origin-evidence';
import type { BaseRpc } from '../origin-evidence';
import { createOneClickService } from '../service';
import { memoryQuoteStore, RELEASE_GRACE_MS } from '../store';
import type { QuoteRecord, QuoteStore } from '../store';

/**
 * Adversarial release tests. SYNTHETIC 1Click statuses and a SYNTHETIC Base
 * chain (finalized block, USDC Transfer logs, receipts). They prove the rules,
 * not any live fact: an expired payable attempt is released only on Base
 * evidence, and anything uncertain keeps the request blocked.
 */
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);
const REFUND = '0x1111111111111111111111111111111111111111';
const DEP_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEP_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SOLVER = '0x2222222222222222222222222222222222222222';
const signer = createFixtureSigner();
const base = fixtureRequests(T0).find(e => e.scenario.name === 'usdc-awaiting')!.request;
// Fixed request (ids would change with the clock in fixtureRequests): expires a day after T0.
const request: MainnetRequest = { ...base, terms: { ...base.terms, fundingExpiresAtNs: (BigInt(T0 + 86_400_000) * 1_000_000n).toString() } };
const LISTED = [{ assetId: BASE_USDC.assetId, blockchain: 'base', symbol: 'USDC', decimals: 6, contractAddress: BASE_USDC.contractAddress }];

/** Synthetic Base chain: 2 s blocks from block 0 at T0 - 365 days. */
class FakeBase implements BaseRpc {
  finalizedAtMs = T0;
  transfers: Array<{ to: string; amount: bigint; atMs: number; tx: string; failed?: boolean }> = [];
  failNext: string | null = null;
  calls: string[] = [];
  block(ms: number) { return BigInt(Math.floor((ms - (T0 - 365 * 86_400_000)) / 2000)); }
  async call(method: string, params: ReadonlyArray<unknown>) {
    this.calls.push(method);
    if (this.failNext === method) { this.failNext = null; throw new OriginRpcError('UNAVAILABLE'); }
    const fin = this.block(this.finalizedAtMs);
    if (method === 'eth_getBlockByNumber') return { number: `0x${fin.toString(16)}`, timestamp: `0x${Math.floor(this.finalizedAtMs / 1000).toString(16)}`, hash: `0x${'f'.repeat(64)}` };
    const log = (t: FakeBase['transfers'][number]) => ({ address: BASE_USDC_CONTRACT, topics: [TRANSFER_TOPIC, `0x${'0'.repeat(24)}${SOLVER.slice(2)}`, `0x${'0'.repeat(24)}${t.to.slice(2)}`], data: `0x${t.amount.toString(16)}`, blockNumber: `0x${this.block(t.atMs).toString(16)}`, transactionHash: t.tx });
    if (method === 'eth_getLogs') {
      const f = params[0] as { topics: string[]; fromBlock: string; toBlock: string };
      const to = `0x${f.topics[2]!.slice(26)}`;
      return this.transfers.filter(t => t.to === to && this.block(t.atMs) >= BigInt(f.fromBlock) && this.block(t.atMs) <= BigInt(f.toBlock)).map(log);
    }
    if (method === 'eth_getTransactionReceipt') {
      const t = this.transfers.find(x => x.tx === params[0]);
      return t ? { status: t.failed ? '0x0' : '0x1', blockNumber: `0x${this.block(t.atMs).toString(16)}`, transactionHash: t.tx, logs: [log(t)] } : null;
    }
    throw new Error(method);
  }
}
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

function chainView(): ChainView {
  return { contractId: FIXTURE_CONTRACT, configProblems: async () => [], isUsdcRegistered: async () => true,
    readRequest: async (id) => ({ request: id === request.terms.id ? request : null, finalTimestampNs: (BigInt(T0) * 1_000_000n).toString() }) };
}

interface Harness { store: QuoteStore; chain: FakeBase; statuses: Map<string, unknown>; now: { v: number }; quote: ReturnType<typeof vi.fn>; service: ReturnType<typeof createOneClickService> }
function harness(opts: { rpc?: boolean } = {}): Harness {
  const store = memoryQuoteStore();
  const chain = new FakeBase();
  const statuses = new Map<string, unknown>();
  const now = { v: T0 };
  const quote = vi.fn(async (body: unknown) => {
    const u = fixtureQuoteResponse(body as Record<string, unknown>, now.v);
    statuses.set(DEP_B, { status: 'PENDING_DEPOSIT', correlationId: u.correlationId, quoteResponse: { correlationId: u.correlationId, quote: { depositAddress: DEP_B } } });
    return signer.signResponse({ ...u, quote: { ...u.quote, depositAddress: DEP_B, deadline: new Date(now.v + 15 * 60_000).toISOString() } });
  });
  const client: OneClickClient = {
    quote, tokens: async () => LISTED,
    status: async (addr) => { const s = statuses.get(addr); if (s instanceof Error) throw s; if (s === undefined) throw new Error('unknown'); return s; },
  };
  const service = createOneClickService({ mode: 'funded', chain: chainView(), client, store, managerPublicKey: signer.publicKey, now: () => now.v, originRpc: opts.rpc === false ? null : chain });
  return { store, chain, statuses, now, quote, service };
}

const recordA = (over: Partial<QuoteRecord> = {}): QuoteRecord => ({
  requestId: request.terms.id, correlationId: 'corr-a', mode: 'funded', originAssetId: BASE_USDC.assetId, refundTo: REFUND,
  depositAddress: DEP_A, depositMemo: null, deadlineMs: T0 - 10 * 60_000, createdAtMs: T0 - 30 * 60_000,
  amountIn: '505155', amountInFormatted: '0.505155', minAmountIn: '500103', amountOut: request.terms.amountBaseUnits, timeEstimateSec: 35, signedResponse: '{}', ...over,
});
async function seedA(h: Harness, over: Partial<QuoteRecord> = {}) {
  const rec = recordA(over);
  const r = await h.store.reserve({ id: 'attempt-a', requestId: rec.requestId, mode: 'funded', payload: '{}', createdAtMs: rec.createdAtMs, deadlineMs: rec.deadlineMs + 60_000, ownerHash: 'payer-a' }, rec.createdAtMs);
  if (r.kind !== 'RESERVED') throw new Error(r.kind);
  await h.store.transition(r.attempt, 'DISPATCHING');
  await h.store.transition({ ...r.attempt, state: 'DISPATCHING' }, 'READY', rec);
  return rec;
}
const statusA = (status: string, swap: Record<string, unknown> = {}) => ({ status, correlationId: 'corr-a', quoteResponse: { correlationId: 'corr-a', quote: { depositAddress: DEP_A } }, swapDetails: swap });
const ask = (h: Harness, secret = 'B'.repeat(43)) => h.service.prepareQuote({ requestId: request.terms.id, originAsset: BASE_USDC.assetId, refundTo: '0x3333333333333333333333333333333333333333', attemptSecret: secret });
const AFTER_GRACE = T0 - 10 * 60_000 + RELEASE_GRACE_MS + 60_000;

describe('releasing an expired payable attempt needs Base chain evidence', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('upstream FAILED never releases, even with no deposit on Base', async () => {
    await seedA(h); h.statuses.set(DEP_A, statusA('FAILED'));
    h.now.v = AFTER_GRACE; h.chain.finalizedAtMs = AFTER_GRACE;
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'UPSTREAM_FAILED' });
    expect(h.quote).not.toHaveBeenCalled();
  });

  it('PENDING_DEPOSIT: blocked inside the grace period, and until Base finality passes deadline + grace', async () => {
    await seedA(h); h.statuses.set(DEP_A, statusA('PENDING_DEPOSIT'));
    h.now.v = T0;
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'AWAITING_FINALITY' });
    h.now.v = AFTER_GRACE; h.chain.finalizedAtMs = AFTER_GRACE - 5 * 60_000; // Base finality lags behind
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'AWAITING_FINALITY' });
    h.chain.finalizedAtMs = AFTER_GRACE;
    const r = await ask(h);
    expect(r.ok).toBe(true);
    expect((await h.store.attempts(request.terms.id))[0]!.released?.reason).toBe('ORIGIN_NO_DEPOSIT_VERIFIED');
  });

  it('delayed deposit: Base shows a deposit 1Click still calls PENDING_DEPOSIT -> stays blocked', async () => {
    await seedA(h); h.statuses.set(DEP_A, statusA('PENDING_DEPOSIT'));
    h.chain.transfers.push({ to: DEP_A, amount: 505155n, atMs: T0 - 9 * 60_000, tx: tx(1) }); // just after the deadline
    h.now.v = AFTER_GRACE; h.chain.finalizedAtMs = AFTER_GRACE;
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'DEPOSIT_UNSEEN_BY_1CLICK' });
  });

  it('REFUNDED is a claim: released only when Base proves the refund to the quote refund address, with the reported amount, after every deposit', async () => {
    await seedA(h);
    h.chain.transfers.push({ to: DEP_A, amount: 505155n, atMs: T0 - 20 * 60_000, tx: tx(1) });
    h.now.v = T0; h.chain.finalizedAtMs = T0;
    // Claimed refund, no refund transaction on Base.
    h.statuses.set(DEP_A, statusA('REFUNDED', { originChainTxHashes: [{ hash: tx(1) }], refundedAmount: '505000' }));
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'REFUND_NOT_VERIFIED' });
    // Refund to another address.
    h.chain.transfers.push({ to: '0x9999999999999999999999999999999999999999', amount: 505000n, atMs: T0 - 15 * 60_000, tx: tx(2) });
    h.statuses.set(DEP_A, statusA('REFUNDED', { originChainTxHashes: [{ hash: tx(1) }, { hash: tx(2) }], refundedAmount: '505000' }));
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'REFUND_NOT_VERIFIED' });
    // Refund to the right address but a different amount than reported.
    h.chain.transfers.push({ to: REFUND, amount: 400000n, atMs: T0 - 15 * 60_000, tx: tx(3) });
    h.statuses.set(DEP_A, statusA('REFUNDED', { originChainTxHashes: [{ hash: tx(1) }, { hash: tx(3) }], refundedAmount: '505000' }));
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'REFUND_NOT_VERIFIED' });
    // Refund not final yet.
    h.chain.transfers.push({ to: REFUND, amount: 505000n, atMs: T0 + 60_000, tx: tx(4) });
    h.statuses.set(DEP_A, statusA('REFUNDED', { originChainTxHashes: [{ hash: tx(1) }, { hash: tx(4) }], refundedAmount: '505000' }));
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'REFUND_NOT_VERIFIED' });
    // Final, exact, to the refund address, after the only deposit: released.
    h.now.v = T0 + 5 * 60_000; h.chain.finalizedAtMs = T0 + 2 * 60_000;
    const r = await ask(h);
    expect(r.ok).toBe(true);
    expect((await h.store.attempts(request.terms.id))[0]!.released?.reason).toBe('ORIGIN_REFUND_VERIFIED');
  });

  it('a second deposit after the refund keeps it blocked', async () => {
    await seedA(h);
    h.chain.transfers.push({ to: DEP_A, amount: 505155n, atMs: T0 - 20 * 60_000, tx: tx(1) }, { to: REFUND, amount: 505000n, atMs: T0 - 15 * 60_000, tx: tx(2) }, { to: DEP_A, amount: 505155n, atMs: T0 - 5 * 60_000, tx: tx(3) });
    h.statuses.set(DEP_A, statusA('REFUNDED', { originChainTxHashes: [{ hash: tx(1) }, { hash: tx(2) }], refundedAmount: '505000' }));
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'REFUND_NOT_VERIFIED' });
  });

  it.each(['KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS', 'INCOMPLETE_DEPOSIT'])('upstream %s keeps it blocked as a deposit in progress', async (s) => {
    await seedA(h); h.statuses.set(DEP_A, statusA(s)); h.now.v = AFTER_GRACE; h.chain.finalizedAtMs = AFTER_GRACE;
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'DEPOSIT_IN_PROGRESS' });
  });

  it('API timeouts: 1Click status timeout, Base RPC timeout, or no Base RPC configured -> blocked, nothing released', async () => {
    await seedA(h); h.now.v = AFTER_GRACE; h.chain.finalizedAtMs = AFTER_GRACE;
    h.statuses.set(DEP_A, new Error('timeout'));
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'EVIDENCE_UNAVAILABLE' });
    h.statuses.set(DEP_A, statusA('PENDING_DEPOSIT'));
    h.chain.failNext = 'eth_getLogs';
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'EVIDENCE_UNAVAILABLE' });
    const noRpc = harness({ rpc: false });
    await seedA(noRpc); noRpc.statuses.set(DEP_A, statusA('PENDING_DEPOSIT')); noRpc.now.v = AFTER_GRACE;
    expect(await ask(noRpc)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'EVIDENCE_UNAVAILABLE' });
    expect((await h.store.attempts(request.terms.id)).every(a => a.released === null)).toBe(true);
  });

  it('a status describing another quote is never evidence', async () => {
    await seedA(h); h.now.v = AFTER_GRACE; h.chain.finalizedAtMs = AFTER_GRACE;
    h.statuses.set(DEP_A, { ...statusA('PENDING_DEPOSIT'), correlationId: 'other', quoteResponse: { correlationId: 'other', quote: { depositAddress: DEP_A } } });
    expect(await ask(h)).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'EVIDENCE_UNAVAILABLE' });
  });
});

describe('late deposits into a released address and two quotes funded later', () => {
  it('a late deposit into released address A blocks new attempts again and is shown to both phones as an earlier attempt', async () => {
    const h = harness();
    await seedA(h); h.statuses.set(DEP_A, statusA('PENDING_DEPOSIT'));
    h.now.v = AFTER_GRACE; h.chain.finalizedAtMs = AFTER_GRACE;
    const b = await ask(h);
    expect(b.ok && b.value.deposit?.address).toBe(DEP_B);
    // 1Click later processes a late deposit into A (contrary to its refund policy).
    h.statuses.set(DEP_A, statusA('PROCESSING'));
    const pub = await h.service.status(request.terms.id);
    expect(pub.ok && pub.value).toMatchObject({ hint: 'PROCESSING', source: 'earlier' });
    expect(JSON.stringify(pub)).not.toContain(DEP_A);
    // Nobody can open a further attempt, now or after B expires (the UI hides B's address while the hint is moving).
    expect(await ask(h, 'C'.repeat(43))).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'EARLIER_ATTEMPT_ACTIVITY' });
    h.now.v += 16 * 60_000;
    expect(await ask(h, 'C'.repeat(43))).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'EARLIER_ATTEMPT_ACTIVITY' });
    expect(h.quote).toHaveBeenCalledTimes(1);
  });

  it('both A (late) and B funded: the public hint still says money is moving (never two receipts from the hint), new attempts refused', async () => {
    const h = harness();
    await seedA(h); h.statuses.set(DEP_A, statusA('PENDING_DEPOSIT'));
    h.now.v = AFTER_GRACE; h.chain.finalizedAtMs = AFTER_GRACE;
    const b = await ask(h);
    expect(b.ok).toBe(true);
    h.statuses.set(DEP_A, statusA('SUCCESS'));
    const corrB = b.ok ? b.value.correlationId : '';
    h.statuses.set(DEP_B, { status: 'SUCCESS', correlationId: corrB, quoteResponse: { correlationId: corrB, quote: { depositAddress: DEP_B } } });
    const pub = await h.service.status(request.terms.id);
    expect(pub.ok && pub.value.hint).toBe('SUCCESS');
    h.now.v += 16 * 60_000;
    expect(await ask(h, 'D'.repeat(43))).toMatchObject({ ok: false, code: 'PAYMENT_IN_PROGRESS' });
    // The contract pays a request once; the second delivery is held as unclaimed
    // (contracts/payments-mainnet mainnet_tests.rs router_late_open_overpayment_exact_payout_duplicate_and_conservation).
  });

  it('the owner sees claim, reported refund and chain proof separately', async () => {
    const h = harness();
    const SECRET = 'S'.repeat(43);
    const OWN_REFUND = '0x3333333333333333333333333333333333333333';
    const b = await ask(h, SECRET);
    expect(b.ok).toBe(true);
    const corr = b.ok ? b.value.correlationId : '';
    const st = (extra: Record<string, unknown>) => ({ status: 'REFUNDED', correlationId: corr, quoteResponse: { correlationId: corr, quote: { depositAddress: DEP_B } }, swapDetails: extra });
    h.chain.transfers.push({ to: DEP_B, amount: 505155n, atMs: T0 + 60_000, tx: tx(11) });
    h.statuses.set(DEP_B, st({ originChainTxHashes: [{ hash: tx(11) }, { hash: tx(12) }], refundedAmount: '505000', refundedAmountFormatted: '0.505' }));
    h.now.v = T0 + 30 * 60_000; h.chain.finalizedAtMs = T0 + 25 * 60_000;
    // Claimed and reported, not on Base: blocked, chain null.
    let r = await h.service.resume({ requestId: request.terms.id, attemptSecret: SECRET });
    expect(r.ok && r.value.evidence).toEqual({ upstream: 'REFUNDED', refundReported: { amountFormatted: '0.505', txCount: 2 }, chain: null, verdict: { blocked: 'REFUND_NOT_VERIFIED' } });
    // The refund appears on Base and is final: chain proof, released verdict.
    h.chain.transfers.push({ to: OWN_REFUND, amount: 505000n, atMs: T0 + 20 * 60_000, tx: tx(12) });
    r = await h.service.resume({ requestId: request.terms.id, attemptSecret: SECRET });
    expect(r.ok && r.value.evidence).toMatchObject({ upstream: 'REFUNDED', chain: { kind: 'REFUND', refunded: '505000', refundTxs: [tx(12)] }, verdict: { released: 'ORIGIN_REFUND_VERIFIED' } });
  });
});

describe('origin-evidence primitives', () => {
  it('a provider that returns logs outside the requested window is not trusted', async () => {
    const rpc: BaseRpc = { call: async (m) => (m === 'eth_getBlockByNumber' ? { number: '0x100000', timestamp: `0x${Math.floor(T0 / 1000).toString(16)}`, hash: `0x${'f'.repeat(64)}` }
      : [{ address: BASE_USDC_CONTRACT, topics: [TRANSFER_TOPIC, `0x${'0'.repeat(64)}`, `0x${'0'.repeat(24)}${DEP_A.slice(2)}`], data: '0x1', blockNumber: '0x1', transactionHash: tx(9) }]) };
    await expect(proveNoDeposit(rpc, { depositAddress: DEP_A, createdAtMs: T0 - 60_000, mustCoverUntilMs: T0 - 1 })).rejects.toBeInstanceOf(OriginRpcError);
  });
  it('a failed refund transaction is not a refund', async () => {
    const chain = new FakeBase(); chain.finalizedAtMs = T0;
    chain.transfers.push({ to: DEP_A, amount: 5n, atMs: T0 - 20 * 60_000, tx: tx(1) }, { to: REFUND, amount: 5n, atMs: T0 - 10 * 60_000, tx: tx(2), failed: true });
    expect(await proveRefund(chain, { depositAddress: DEP_A, refundTo: REFUND, createdAtMs: T0 - 30 * 60_000, reportedTxHashes: [tx(2)], reportedRefundedAmount: '5' })).toEqual({ ok: false, reason: 'REFUND_NOT_FOUND' });
  });
  it('a search range beyond the bound is not evidence', async () => {
    const chain = new FakeBase(); chain.finalizedAtMs = T0;
    await expect(proveNoDeposit(chain, { depositAddress: DEP_A, createdAtMs: T0 - 30 * 86_400_000, mustCoverUntilMs: T0 - 1 })).rejects.toMatchObject({ code: 'RANGE_TOO_LARGE' });
  });
});
