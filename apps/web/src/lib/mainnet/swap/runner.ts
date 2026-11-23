import { verifyMainnetSwapStep, type MainnetSigningProfiles, type MainnetSwapStepProof } from '@taply/near-client';
import { prepareOperation, walletBackend, signerIdentity, type AuthorityState, type WalletSigner } from '@/lib/mainnet/wallet-ops';
import { deriveJobStatus, nextPendingStep, swapOutput, updateSwapJob, type StepStatus, type SwapJob } from './journal';
import { stepOperation } from './model';

/**
 * Runs ONE swap step through the existing signing path:
 * Codex planner (swap policy) -> device ledger reservation -> wallet -> FINAL read,
 * then proves the step from the receipts (verifyMainnetSwapStep).
 *
 * Never re-sends: a step whose outcome is not proven becomes `unknown` and only a
 * ledger/receipt read can move it. A step is signed again only when the ledger
 * shows it was never reserved (nothing was handed to a wallet).
 */
export interface SwapRunnerDeps {
  readonly signer: WalletSigner;
  readonly profiles: MainnetSigningProfiles;
  readonly authority: AuthorityState;
  readonly deviceId: string;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Errors thrown before Codex's backend reserves anything: nothing was signed or sent. */
const PRE_RESERVATION = new Set(['USER_REJECTED_BEFORE_HANDOFF', 'REVIEW_EXPIRED', 'REVIEW_CHANGED', 'WALLET_LOCKED', 'MAINNET_SIGNING_DISABLED',
  'OUTCOME_UNRESOLVED', 'OTHER_DEVICE_READ_ONLY', 'OPERATION_ALREADY_CONSUMED', 'STALE_ATTEMPT', 'STALE_NONCE', 'ARCHIVE_REQUIRED']);

export function proofToStep(proof: MainnetSwapStepProof): { status: StepStatus; amount: string | null; txHash: string | null } {
  switch (proof.kind) {
    case 'SWAPPED': return { status: 'done', amount: proof.amountOut, txHash: proof.transactionHash };
    case 'WRAPPED': case 'UNWRAPPED': case 'REGISTERED': return { status: 'done', amount: proof.amount, txHash: proof.transactionHash };
    case 'REFUNDED': return { status: 'refunded', amount: proof.refunded, txHash: proof.transactionHash };
    case 'OUTPUT_NOT_DELIVERED': return { status: 'not_delivered', amount: null, txHash: proof.transactionHash };
    case 'FAILED': return { status: 'failed', amount: null, txHash: proof.transactionHash };
    default: return { status: 'unknown', amount: null, txHash: null };
  }
}

function code(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code;
  return e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'UNKNOWN';
}

export class SwapStepError extends Error { constructor(readonly code: string) { super(code); } }

function setStep(deps: SwapRunnerDeps, job: SwapJob, index: number, patch: Partial<SwapJob['steps'][number]>): SwapJob {
  return updateSwapJob(deps.storage, job.accountId, job.id, (j) => {
    j.steps[index] = { ...j.steps[index]!, ...patch };
    j.status = deriveJobStatus(j);
    return j;
  });
}

async function verify(deps: SwapRunnerDeps, job: SwapJob, index: number, txHash: string): Promise<SwapJob> {
  const operation = stepOperation(job.steps[index]!.step, job.id, swapOutput(job));
  const proof = await verifyMainnetSwapStep(deps.profiles.network, { transactionHash: txHash, accountId: job.accountId, operation }, deps.fetcher);
  const mapped = proofToStep(proof);
  return setStep(deps, job, index, { status: mapped.status, amount: mapped.amount, txHash: mapped.txHash ?? txHash });
}

/** Sign the next pending step. Returns the updated job; throws SwapStepError only when nothing was reserved. */
export async function runNextSwapStep(deps: SwapRunnerDeps, job: SwapJob): Promise<SwapJob> {
  const index = nextPendingStep(job);
  if (index < 0) return job;
  if (signerIdentity(deps.signer).accountId !== job.accountId) throw new SwapStepError('IDENTITY_CHANGED');
  const operation = stepOperation(job.steps[index]!.step, job.id, swapOutput(job));
  let prepared;
  try {
    prepared = await prepareOperation({ operation, signer: deps.signer, profiles: deps.profiles, authority: deps.authority, deviceId: deps.deviceId, ...(deps.fetcher ? { fetcher: deps.fetcher } : {}) });
  } catch (e) { throw new SwapStepError(code(e)); }
  const submit = prepared.submit;
  if (!submit) throw new SwapStepError('SIGNING_UNAVAILABLE');
  const reviewId = prepared.review.id;
  let current = setStep(deps, job, index, { status: 'signing', operationHash: prepared.review.operationHash });
  try {
    const outcome = await submit(async (r) => r.id === reviewId);
    if (outcome.kind === 'OUTCOME_UNRESOLVED') return setStep(deps, current, index, { status: 'unknown', txHash: outcome.transactionHash });
    if (outcome.execution === 'FAILURE') return setStep(deps, current, index, { status: 'failed', txHash: outcome.transactionHash });
    current = setStep(deps, current, index, { txHash: outcome.transactionHash });
    return await verify(deps, current, index, outcome.transactionHash);
  } catch (e) {
    const c = code(e);
    if (PRE_RESERVATION.has(c)) { setStep(deps, current, index, { status: 'pending', operationHash: null }); throw new SwapStepError(c); }
    // Anything else after the reservation may have reached the network: ask the ledger.
    return resolveSwapStep(deps, current);
  }
}

/**
 * Re-reads a `signing`/`unknown` step from the device ledger and the chain.
 * - pending in the ledger: one FINAL reconcile; still unknown otherwise;
 * - completed in the ledger: verify its transaction hash;
 * - not in the ledger at all: never reserved, so it is safe to sign (back to `pending`).
 */
export async function resolveSwapStep(deps: SwapRunnerDeps, job: SwapJob): Promise<SwapJob> {
  const index = job.steps.findIndex(s => s.status === 'signing' || s.status === 'unknown');
  if (index < 0) return job;
  const step = job.steps[index]!;
  const backend = walletBackend({ signer: deps.signer, profiles: deps.profiles, authority: deps.authority, deviceId: deps.deviceId });
  if (backend === null) return setStep(deps, job, index, { status: 'unknown' });
  let ledger;
  try { ledger = await backend.readAttempt(); } catch { return setStep(deps, job, index, { status: 'unknown' }); }
  if (step.operationHash !== null && ledger?.pending?.operationHash === step.operationHash) {
    try {
      const r = await backend.reconcile(step.txHash ?? undefined);
      if (r.kind === 'FINAL_EXECUTION') {
        if (r.execution === 'FAILURE') return setStep(deps, job, index, { status: 'failed', txHash: r.transactionHash });
        return verify(deps, job, index, r.transactionHash);
      }
    } catch { /* stays unknown */ }
    return setStep(deps, job, index, { status: 'unknown' });
  }
  const done = step.operationHash === null ? undefined : ledger?.completed.find(c => c.attempt.operationHash === step.operationHash);
  if (done) {
    if (done.proof.execution === 'FAILURE') return setStep(deps, job, index, { status: 'failed', txHash: done.proof.transactionHash });
    return verify(deps, job, index, done.proof.transactionHash);
  }
  if (step.txHash !== null) return verify(deps, job, index, step.txHash);
  // No reservation and no hash: the wallet was never asked to sign this step.
  return setStep(deps, job, index, { status: 'pending', operationHash: null });
}
