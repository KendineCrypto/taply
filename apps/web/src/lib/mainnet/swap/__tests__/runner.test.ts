import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MAINNET_USDC } from '@taply/shared';
import { MAINNET_WRAP } from '@taply/near-client';

// The runner talks to Codex's backend only through wallet-ops and to the chain only through
// verifyMainnetSwapStep; both are replaced here to drive every outcome deterministically.
const ops = vi.hoisted(() => ({ prepare: vi.fn(), backend: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/mainnet/wallet-ops', () => ({
  prepareOperation: ops.prepare,
  walletBackend: ops.backend,
  signerIdentity: () => ({ accountId: 'a'.repeat(64), publicKey: 'ed25519:x' }),
}));
vi.mock('@taply/near-client', async (orig) => ({ ...(await orig<Record<string, unknown>>()), verifyMainnetSwapStep: ops.verify }));

import { createSwapJob, loadSwapJobs } from '../journal';
import { resolveSwapStep, runNextSwapStep, SwapStepError, type SwapRunnerDeps } from '../runner';

const ME = 'a'.repeat(64), H = 'GYggcAW51C2VsmiuQCN1qAibDHP7mhyeyafcxHbUkB17';
function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; } };
}
const opHash = 'c'.repeat(64);
function setup() {
  const storage = memory();
  const deps: SwapRunnerDeps = { signer: { kind: 'internal', vault: {} as never }, profiles: { network: { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'x' } }, authority: { kind: 'device', store: {} as never }, deviceId: 'd', storage };
  const job = createSwapJob(storage, { id: 'e'.repeat(64), accountId: ME, from: 'near', to: 'usdc', amountIn: '10', expectedOut: '30', minOut: '29', slippageBps: 50, priceImpactBps: 0, quoteBlock: '1',
    steps: [{ kind: 'wrap', amount: '10' }, { kind: 'swap', tokenIn: MAINNET_WRAP, tokenOut: MAINNET_USDC, amountIn: '10', minOut: '29' }] });
  return { storage, deps, job };
}
const prepared = (submit: () => Promise<unknown>) => ({ review: { id: 'r1', operationHash: opHash }, authority: 'device', submit });

describe('swap runner', () => {
  beforeEach(() => { ops.prepare.mockReset(); ops.backend.mockReset(); ops.verify.mockReset(); });

  it('a verified step is done; the next step uses the swap output only after proof', async () => {
    const { deps, job } = setup();
    ops.prepare.mockResolvedValue(prepared(async () => ({ kind: 'FINAL_EXECUTION', transactionHash: H, execution: 'SUCCESS' })));
    ops.verify.mockResolvedValue({ kind: 'WRAPPED', transactionHash: H, amount: '10' });
    const after = await runNextSwapStep(deps, job);
    expect(after.steps[0]).toMatchObject({ status: 'done', txHash: H, amount: '10', operationHash: opHash });
    expect(ops.prepare.mock.calls[0]![0].operation).toEqual({ kind: 'swapWrap', swapId: job.id, amountYocto: '10' });
  });

  it('a pre-reservation refusal (user rejected, stale quote) leaves the step pending and signs nothing', async () => {
    const { deps, job, storage } = setup();
    ops.prepare.mockResolvedValue(prepared(async () => { throw new Error('USER_REJECTED_BEFORE_HANDOFF'); }));
    await expect(runNextSwapStep(deps, job)).rejects.toBeInstanceOf(SwapStepError);
    expect(loadSwapJobs(storage, ME)[0]!.steps[0]).toMatchObject({ status: 'pending', operationHash: null });
    ops.prepare.mockRejectedValue(new Error('SWAP_QUOTE_MOVED'));
    await expect(runNextSwapStep(deps, job)).rejects.toMatchObject({ code: 'SWAP_QUOTE_MOVED' });
  });

  it('an unresolved outcome is unknown and blocks the job; no automatic resend', async () => {
    const { deps, job, storage } = setup();
    ops.prepare.mockResolvedValue(prepared(async () => ({ kind: 'OUTCOME_UNRESOLVED', transactionHash: H })));
    const after = await runNextSwapStep(deps, job);
    expect(after.steps[0]!.status).toBe('unknown');
    expect(after.status).toBe('unknown');
    expect(await runNextSwapStep(deps, after)).toBe(after); // nothing pending to run
    expect(ops.prepare).toHaveBeenCalledTimes(1);
    expect(loadSwapJobs(storage, ME)[0]!.status).toBe('unknown');
  });

  it('resolve: pending in the ledger -> FINAL reconcile + receipt proof; completed -> proof; absent -> safe to sign again', async () => {
    const { deps, job } = setup();
    ops.prepare.mockResolvedValue(prepared(async () => ({ kind: 'OUTCOME_UNRESOLVED', transactionHash: H })));
    const unknown = await runNextSwapStep(deps, job);
    // still pending, RPC cannot prove it
    ops.backend.mockReturnValue({ readAttempt: async () => ({ pending: { operationHash: opHash }, completed: [] }), reconcile: async () => ({ kind: 'OUTCOME_UNRESOLVED' }) });
    expect((await resolveSwapStep(deps, unknown)).steps[0]!.status).toBe('unknown');
    // proven on chain
    ops.backend.mockReturnValue({ readAttempt: async () => ({ pending: { operationHash: opHash }, completed: [] }), reconcile: async () => ({ kind: 'FINAL_EXECUTION', transactionHash: H, execution: 'SUCCESS' }) });
    ops.verify.mockResolvedValue({ kind: 'WRAPPED', transactionHash: H, amount: '10' });
    expect((await resolveSwapStep(deps, unknown)).steps[0]!.status).toBe('done');
    // never reserved: back to pending (nothing reached a wallet)
    const fresh = setup();
    const signing = { ...fresh.job, steps: fresh.job.steps.map((s, i) => i === 0 ? { ...s, status: 'signing' as const, operationHash: opHash } : s) };
    ops.backend.mockReturnValue({ readAttempt: async () => null, reconcile: async () => ({ kind: 'NO_PENDING_ATTEMPT' }) });
    expect((await resolveSwapStep(fresh.deps, signing)).steps[0]).toMatchObject({ status: 'pending', operationHash: null });
  });

  it('swap refunded on chain (slippage) is refunded, never done; FINAL failure is failed', async () => {
    const { deps, job } = setup();
    ops.prepare.mockResolvedValue(prepared(async () => ({ kind: 'FINAL_EXECUTION', transactionHash: H, execution: 'SUCCESS' })));
    ops.verify.mockResolvedValueOnce({ kind: 'WRAPPED', transactionHash: H, amount: '10' }).mockResolvedValueOnce({ kind: 'REFUNDED', transactionHash: H, refunded: '10', tokenIn: MAINNET_WRAP });
    const one = await runNextSwapStep(deps, job);
    const two = await runNextSwapStep(deps, one);
    expect(two.steps[1]!.status).toBe('refunded');
    expect(two.status).toBe('partial');
    const f = setup();
    ops.prepare.mockResolvedValue(prepared(async () => ({ kind: 'FINAL_EXECUTION', transactionHash: H, execution: 'FAILURE' })));
    expect((await runNextSwapStep(f.deps, f.job)).steps[0]!.status).toBe('failed');
  });
});
