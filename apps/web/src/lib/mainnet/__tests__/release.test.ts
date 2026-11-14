import { describe, expect, it } from 'vitest';
import type { MainnetWalletReview } from '@taply/near-client';
import { MAINNET_SIGNING_RELEASE_APPROVED } from '../release-gates';
import { currentAuthority, submitReviewed } from '../wallet-ops';
import type { PreparedOperation } from '../wallet-ops';
import { submitAllowed } from '@/components/mainnet/Operation';

const review = { id: 'r1' } as unknown as Readonly<MainnetWalletReview>;
const H = 'AMyhxsywbFuWHBZdxfXpJiEwJB3tHZZ6cjfJ1wmr9jJm';
type Rec = { kind: 'FINAL_EXECUTION'; transactionHash: string; execution: 'SUCCESS' | 'FAILURE' } | { kind: 'OUTCOME_UNRESOLVED' } | { kind: 'NO_PENDING_ATTEMPT' };
function backend(sent: { transactionHash: string | null }, reads: Array<Rec | Error>) {
  const calls = { submit: 0, reconcile: [] as Array<string | undefined> };
  return {
    calls,
    b: {
      submit: async () => { calls.submit++; return { kind: 'OUTCOME_UNRESOLVED' as const, ...sent }; },
      reconcile: async (h?: string) => { calls.reconcile.push(h); const r = reads.shift() ?? { kind: 'OUTCOME_UNRESOLVED' as const }; if (r instanceof Error) throw r; return r; },
    } as never,
  };
}

describe('release submit path (device ledger)', () => {
  it('FINAL read after submit reports the exact transaction; submit called once', async () => {
    const { b, calls } = backend({ transactionHash: H }, [{ kind: 'FINAL_EXECUTION', transactionHash: H, execution: 'SUCCESS' }]);
    expect(await submitReviewed(b, review, async () => true, 4, 0)).toEqual({ kind: 'FINAL_EXECUTION', transactionHash: H, execution: 'SUCCESS' });
    expect(calls).toEqual({ submit: 1, reconcile: [H] });
  });
  it('not yet FINAL / RPC error → unresolved with the hash, never failed, never resent', async () => {
    const { b, calls } = backend({ transactionHash: H }, [{ kind: 'OUTCOME_UNRESOLVED' }, new Error('offline'), { kind: 'OUTCOME_UNRESOLVED' }, { kind: 'OUTCOME_UNRESOLVED' }]);
    expect(await submitReviewed(b, review, async () => true, 4, 0)).toEqual({ kind: 'OUTCOME_UNRESOLVED', transactionHash: H });
    expect(calls.submit).toBe(1);
    expect(calls.reconcile).toHaveLength(4);
  });
  it('lost hash (external wallet) → unresolved without a hint lookup', async () => {
    const { b, calls } = backend({ transactionHash: null }, []);
    expect(await submitReviewed(b, review, async () => true, 4, 0)).toEqual({ kind: 'OUTCOME_UNRESOLVED', transactionHash: null });
    expect(calls.reconcile).toEqual([]);
  });
  it('errors before reservation propagate unchanged (nothing reserved or signed)', async () => {
    const b = { submit: async () => { throw new Error('MAINNET_SIGNING_DISABLED'); }, reconcile: async () => ({ kind: 'OUTCOME_UNRESOLVED' }) } as never;
    await expect(submitReviewed(b, review, async () => true, 1, 0)).rejects.toThrow('MAINNET_SIGNING_DISABLED');
  });
  it('confirm button: needs the gate, the env flag and a ledger-backed review', () => {
    const p = (authority: PreparedOperation['authority'], submit = true): PreparedOperation => ({ review, authority, ...(submit ? { submit: async () => ({ kind: 'OUTCOME_UNRESOLVED', transactionHash: null }) } : {}) });
    expect(submitAllowed(p('device'), true)).toBe(MAINNET_SIGNING_RELEASE_APPROVED);
    expect(submitAllowed(p('device'), false)).toBe(false);
    expect(submitAllowed(p('device', false), true)).toBe(false);
    for (const a of ['unavailable', 'http', 'http-gated', 'http-unavailable'] as const) expect(submitAllowed(p(a), true)).toBe(false);
  });
  it('default Mainnet build: no ledger flag → no device ledger', () => {
    expect(process.env.NEXT_PUBLIC_TAPLY_MAINNET_LEDGER).not.toBe('device');
    expect(currentAuthority().kind).not.toBe('device');
  });
});
