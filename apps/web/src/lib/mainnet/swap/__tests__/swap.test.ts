import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MAINNET_USDC } from '@taply/shared';
import { MAINNET_WRAP, MAINNET_SWAP_LIMITS, type MainnetSwapAccountState } from '@taply/near-client';
import { SWAP_ASSETS, type SwapStep, amountToInput, checkBalances, maxSwapInput, parseSwapAmount, planSwap, searchSwapAssets, stepOperation, nativeReserveYocto } from '../model';
import { createSwapJob, deriveJobStatus, loadSwapJobs, nextPendingStep, swapJournalKey, updateSwapJob, SwapJournalError, type SwapJob } from '../journal';
import { swapEn, swapTr } from '../copy';
import { useSwapQuote, QUOTE_DEBOUNCE_MS, QUOTE_TTL_MS, QUOTE_AUTO_REFRESHES, type QuoteFetcher } from '../use-swap-quote';
import { proofToStep } from '../runner';

const NEAR = 10n ** 24n;
const ME = 'a'.repeat(64);
const account = (over: Partial<MainnetSwapAccountState> = {}): MainnetSwapAccountState => ({
  nearYocto: (5n * NEAR).toString(), storageUsageBytes: '182', gasPriceYocto: '100000000', storageByteCostYocto: '10000000000000000000',
  balances: { [MAINNET_WRAP]: '0', [MAINNET_USDC]: '2000000' } as MainnetSwapAccountState['balances'],
  registered: { [MAINNET_WRAP]: false, [MAINNET_USDC]: false } as MainnetSwapAccountState['registered'],
  storageMinYocto: { [MAINNET_WRAP]: '1250000000000000000000', [MAINNET_USDC]: '1250000000000000000000' } as MainnetSwapAccountState['storageMinYocto'],
  ...over,
});
function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; } };
}

describe('amount parsing (no float, both locales, paste)', () => {
  const near = SWAP_ASSETS.near, usdc = SWAP_ASSETS.usdc;
  it('accepts comma or dot, spaces from paste, leading zeros; exact base units', () => {
    expect(parseSwapAmount('0,5', near)).toEqual({ kind: 'ok', baseUnits: 5n * 10n ** 23n });
    expect(parseSwapAmount(' 0.5 ', near)).toEqual({ kind: 'ok', baseUnits: 5n * 10n ** 23n });
    expect(parseSwapAmount('00012', usdc)).toEqual({ kind: 'ok', baseUnits: 12_000000n });
    expect(parseSwapAmount('1 000', usdc)).toEqual({ kind: 'ok', baseUnits: 1000_000000n });
    expect(parseSwapAmount('.5', usdc)).toEqual({ kind: 'ok', baseUnits: 500000n });
    expect(parseSwapAmount('0.000000000000000000000001', near)).toEqual({ kind: 'ok', baseUnits: 1n });
  });
  it('refuses empty, zero, negative, excess precision, huge, ambiguous and junk', () => {
    expect(parseSwapAmount('', near).kind).toBe('empty');
    expect(parseSwapAmount('0', near)).toMatchObject({ reason: 'zero' });
    expect(parseSwapAmount('0,000', near)).toMatchObject({ reason: 'zero' });
    expect(parseSwapAmount('-1', near)).toMatchObject({ reason: 'negative' });
    expect(parseSwapAmount('1.0000001', usdc)).toMatchObject({ reason: 'precision' });
    expect(parseSwapAmount('1234567890123', usdc)).toMatchObject({ reason: 'too_large' });
    for (const bad of ['1.234,5', '1,2,3', '1e5', 'abc', '.', '0x10', '١']) expect(parseSwapAmount(bad, usdc).kind).toBe('error');
  });
  it('round-trips to input text in the person\'s separator', () => {
    expect(amountToInput(1_500000n, usdc, 'tr')).toBe('1,5');
    expect(amountToInput(2n * NEAR, near, 'en')).toBe('2');
  });
});

describe('token list', () => {
  it('verified list only; NEAR and wNEAR distinct; search by symbol/name/contract', () => {
    expect(searchSwapAssets('').map(a => a.id)).toEqual(['near', 'usdc', 'wnear']);
    expect(searchSwapAssets('wrap.near').map(a => a.id)).toEqual(['wnear']);
    expect(searchSwapAssets(MAINNET_USDC).map(a => a.id)).toEqual(['usdc']);
    expect(searchSwapAssets('usdt')).toEqual([]);
    expect(SWAP_ASSETS.near.contract).toBeNull();
    expect(SWAP_ASSETS.usdc.contract).toBe('17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
  });
});

describe('step plan, fees and Max', () => {
  it('NEAR→USDC unregistered: register wNEAR, register USDC, wrap, swap; storage is refundable deposit, gas is an upper bound', () => {
    const p = planSwap({ from: SWAP_ASSETS.near, to: SWAP_ASSETS.usdc, amountIn: NEAR / 10n, expectedOut: 299607n, slippageBps: 50, account: account() });
    expect(p.steps.map(s => s.kind)).toEqual(['register', 'register', 'wrap', 'swap']);
    expect(p.minOut).toBe(298108n);
    expect(p.storageDepositYocto).toBe(2_500000000000000000000n);
    expect(p.maxNetworkFeeYocto).toBe((30n + 30n + 20n + 150n) * 10n ** 12n * 100000000n);
    expect(p.nativeNeedYocto).toBe(NEAR / 10n + p.storageDepositYocto + p.maxNetworkFeeYocto + 1n);
  });
  it('registered NEAR→USDC is 2 steps; USDC→NEAR is swap + unwrap of the verified output; NEAR↔wNEAR are 1:1', () => {
    const reg = account({ registered: { [MAINNET_WRAP]: true, [MAINNET_USDC]: true } as MainnetSwapAccountState['registered'] });
    expect(planSwap({ from: SWAP_ASSETS.near, to: SWAP_ASSETS.usdc, amountIn: 1n, expectedOut: 1000n, slippageBps: 50, account: reg }).steps.map(s => s.kind)).toEqual(['wrap', 'swap']);
    const back = planSwap({ from: SWAP_ASSETS.usdc, to: SWAP_ASSETS.near, amountIn: 1_000000n, expectedOut: 331n * 10n ** 21n, slippageBps: 50, account: reg });
    expect(back.steps).toEqual([{ kind: 'swap', tokenIn: MAINNET_USDC, tokenOut: MAINNET_WRAP, amountIn: '1000000', minOut: (331n * 10n ** 21n * 9950n / 10000n).toString() }, { kind: 'unwrap', amount: 'FROM_SWAP' }]);
    expect(planSwap({ from: SWAP_ASSETS.wnear, to: SWAP_ASSETS.near, amountIn: 5n, expectedOut: 5n, slippageBps: 50, account: reg }).steps).toEqual([{ kind: 'unwrap', amount: '5' }]);
    expect(() => planSwap({ from: SWAP_ASSETS.usdc, to: SWAP_ASSETS.usdc, amountIn: 5n, expectedOut: 5n, slippageBps: 50, account: reg })).toThrow('SAME_ASSET');
  });
  it('Max keeps storage + 2×300 Tgas reserve and every step\'s deposits and gas; the result passes the balance check', () => {
    const a = account();
    const max = maxSwapInput(SWAP_ASSETS.near, SWAP_ASSETS.usdc, a);
    const p = planSwap({ from: SWAP_ASSETS.near, to: SWAP_ASSETS.usdc, amountIn: max, expectedOut: 1000n, slippageBps: 50, account: a });
    expect(checkBalances(SWAP_ASSETS.near, max, p, a)).toBe('ok');
    const over = planSwap({ from: SWAP_ASSETS.near, to: SWAP_ASSETS.usdc, amountIn: max + 1n, expectedOut: 1000n, slippageBps: 50, account: a });
    expect(checkBalances(SWAP_ASSETS.near, max + 1n, over, a)).toBe('insufficient_native_fee');
    expect(BigInt(a.nearYocto) - max).toBeGreaterThan(nativeReserveYocto(a));
    expect(maxSwapInput(SWAP_ASSETS.usdc, SWAP_ASSETS.near, a)).toBe(2_000000n);
    // Tokens: Max is the full balance but never above the per-swap limit.
    expect(maxSwapInput(SWAP_ASSETS.usdc, SWAP_ASSETS.near, account({ balances: { [MAINNET_WRAP]: '0', [MAINNET_USDC]: '999000000' } as MainnetSwapAccountState['balances'] }))).toBe(MAINNET_SWAP_LIMITS.maxInput[MAINNET_USDC]);
    // A token swap still needs native NEAR for gas.
    const poor = account({ nearYocto: '10000000000000000000000' });
    const tp = planSwap({ from: SWAP_ASSETS.usdc, to: SWAP_ASSETS.near, amountIn: 1_000000n, expectedOut: 10n ** 23n, slippageBps: 50, account: poor });
    expect(checkBalances(SWAP_ASSETS.usdc, 1_000000n, tp, poor)).toBe('insufficient_native_fee');
    expect(checkBalances(SWAP_ASSETS.usdc, 3_000000n, tp, account())).toBe('insufficient_token');
  });
  it('step -> planner operation; FROM_SWAP needs the verified swap output', () => {
    expect(stepOperation({ kind: 'unwrap', amount: 'FROM_SWAP' }, 'f'.repeat(64), '42')).toEqual({ kind: 'swapUnwrap', swapId: 'f'.repeat(64), amountYocto: '42' });
    expect(() => stepOperation({ kind: 'unwrap', amount: 'FROM_SWAP' }, 'f'.repeat(64), null)).toThrow('UNWRAP_AMOUNT_UNKNOWN');
  });
});

describe('swap journal (resume, one open job, fail closed)', () => {
  const base = { id: 'e'.repeat(64), accountId: ME, from: 'near' as const, to: 'usdc' as const, amountIn: '1', expectedOut: '2', minOut: '1', slippageBps: 50, priceImpactBps: 0, quoteBlock: '1',
    steps: [{ kind: 'wrap', amount: '1' }, { kind: 'swap', tokenIn: MAINNET_WRAP, tokenOut: MAINNET_USDC, amountIn: '1', minOut: '1' }] as SwapStep[] };
  it('persists, refuses a second open job (multi-tab), and derives status only from proven steps', () => {
    const s = memory();
    const job = createSwapJob(s, base, 1);
    expect(loadSwapJobs(s, ME)[0]!.id).toBe(job.id);
    expect(() => createSwapJob(s, { ...base, id: 'd'.repeat(64) })).toThrow(SwapJournalError);
    const set = (i: number, status: SwapJob['steps'][number]['status']) => updateSwapJob(s, ME, job.id, j => { j.steps[i]!.status = status; j.status = deriveJobStatus(j); return j; });
    set(0, 'done');
    expect(nextPendingStep(loadSwapJobs(s, ME)[0]!)).toBe(1);
    expect(deriveJobStatus(set(1, 'unknown'))).toBe('unknown');
    expect(nextPendingStep(loadSwapJobs(s, ME)[0]!)).toBe(-1);
    expect(deriveJobStatus(set(1, 'refunded'))).toBe('partial');
    expect(deriveJobStatus(set(1, 'not_delivered'))).toBe('partial');
    expect(deriveJobStatus(set(1, 'done'))).toBe('completed');
  });
  it('a corrupt journal blocks instead of being replaced', () => {
    const s = memory();
    s.setItem(swapJournalKey(ME), '{"jobs":[{"v":2}]}');
    expect(() => loadSwapJobs(s, ME)).toThrow('CORRUPT');
    expect(() => createSwapJob(s, base)).toThrow('CORRUPT');
    expect(s.getItem(swapJournalKey(ME))).toBe('{"jobs":[{"v":2}]}');
  });
});

describe('proof -> step status (never success without receipts)', () => {
  it('maps every proof kind', () => {
    expect(proofToStep({ kind: 'SWAPPED', transactionHash: 'h', amountIn: '1', amountOut: '9', tokenIn: MAINNET_WRAP, tokenOut: MAINNET_USDC, blockHash: 'b' })).toEqual({ status: 'done', amount: '9', txHash: 'h' });
    expect(proofToStep({ kind: 'REFUNDED', transactionHash: 'h', refunded: '1', tokenIn: MAINNET_WRAP }).status).toBe('refunded');
    expect(proofToStep({ kind: 'OUTPUT_NOT_DELIVERED', transactionHash: 'h', amountIn: '1', lostfound: true }).status).toBe('not_delivered');
    expect(proofToStep({ kind: 'FAILED', transactionHash: 'h' }).status).toBe('failed');
    for (const reason of ['MISMATCH', 'UNAVAILABLE', 'NOT_FINAL'] as const) expect(proofToStep({ kind: 'NOT_VERIFIED', reason }).status).toBe('unknown');
  });
});

describe('copy', () => {
  it('EN and TR have identical keys', () => {
    const keys = (o: object, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' && v !== null ? keys(v, `${p}${k}.`) : [`${p}${k}`]).sort();
    expect(keys(swapTr)).toEqual(keys(swapEn));
  });
});

describe('quote lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  const from = SWAP_ASSETS.near, to = SWAP_ASSETS.usdc;
  const fake = (delays: Record<string, number>, calls: string[]): QuoteFetcher => async (_f, _t, amount) => {
    calls.push(String(amount));
    await new Promise(r => setTimeout(r, delays[String(amount)] ?? 0));
    return { read: { blockHash: 'b', blockHeight: String(amount), blockTimestampNs: '1', pool: { reserves: {} as never, feeBps: 30 }, account: null }, math: null, expectedOut: amount };
  };
  it('debounces typing and a slow OLD response never overwrites a newer quote', async () => {
    const calls: string[] = [];
    const fetcher = fake({ '1': 2000, '2': 10 }, calls);
    const { result, rerender } = renderHook((p: { amount: bigint }) => useSwapQuote({ from, to, amount: p.amount, accountId: null, enabled: true, fetcher }), { initialProps: { amount: 1n } });
    await act(async () => { await vi.advanceTimersByTimeAsync(QUOTE_DEBOUNCE_MS + 1); });
    rerender({ amount: 2n });
    await act(async () => { await vi.advanceTimersByTimeAsync(QUOTE_DEBOUNCE_MS + 20); });
    expect(result.current.current?.expectedOut).toBe(2n);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); // the old request for 1 resolves now
    expect(result.current.current?.expectedOut).toBe(2n);
    expect(calls).toEqual(['1', '2']);
    // Fast typing inside the debounce window sends nothing in between.
    rerender({ amount: 3n }); rerender({ amount: 4n }); rerender({ amount: 5n });
    await act(async () => { await vi.advanceTimersByTimeAsync(QUOTE_DEBOUNCE_MS + 1); });
    expect(calls).toEqual(['1', '2', '5']);
  });
  it('a changed input never returns the previous quote; expiry refreshes at most N times, then stops', async () => {
    const calls: string[] = [];
    const fetcher = fake({}, calls);
    const { result, rerender } = renderHook((p: { amount: bigint }) => useSwapQuote({ from, to, amount: p.amount, accountId: null, enabled: true, fetcher }), { initialProps: { amount: 7n } });
    await act(async () => { await vi.advanceTimersByTimeAsync(QUOTE_DEBOUNCE_MS + 1); });
    expect(result.current.current?.expectedOut).toBe(7n);
    rerender({ amount: 8n });
    expect(result.current.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(QUOTE_DEBOUNCE_MS + 1); });
    const before = calls.length;
    for (let i = 0; i < QUOTE_AUTO_REFRESHES + 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(QUOTE_TTL_MS + 5); });
    expect(calls.length - before).toBe(QUOTE_AUTO_REFRESHES);
    expect(result.current.expired).toBe(true);
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(5); });
    expect(result.current.expired).toBe(false);
    vi.useRealTimers();
  });
});
