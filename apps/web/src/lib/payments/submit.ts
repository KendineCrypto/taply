import type { PreparedContractCall, PreparedProtectedCall, PreparedTokenCall } from '@taply/near-client';
import type { IntentTerms } from '@/lib/protocol';
import { WalletDeclinedError, WalletNotDispatchedError, WalletNotSentError } from '@/lib/wallet/adapter';
import type { SignOutcome, WalletCall } from '@/lib/wallet/adapter';
import { JournalBlockedError, isBlocking } from './journal';
import type { JournalEntry, JournalMethod, SubmissionJournal } from './journal';
import type { PaymentView } from './intent';

/**
 * One signing attempt, journaled before the wallet opens.
 *
 * The result says what the WALLET reported. It never says the call worked: every
 * caller follows up with a finalized `get_request` read, and the screen shows that.
 */
export type SubmitResult =
  | { readonly kind: 'submitted'; readonly transactionHash: string }
  /** Possibly broadcast. Reconcile with the chain; never retry blindly. */
  | { readonly kind: 'unknown'; readonly transactionHash?: string }
  /** The person declined in the wallet. Nothing was sent. */
  | { readonly kind: 'rejected' }
  /** An in-app wallet could not prepare it (before signing). Nothing was sent. */
  | { readonly kind: 'not_sent' }
  /** The wallet is connected as a different account. Nothing was sent. */
  | { readonly kind: 'wrong_account' }
  /** An earlier attempt for this request is still unexplained. Nothing was sent. */
  | { readonly kind: 'blocked'; readonly entry: JournalEntry }
  /** No usable journal (storage disabled or corrupted). Nothing was sent. */
  | { readonly kind: 'no_journal' };

export async function submitCall(input: {
  readonly journal: SubmissionJournal | null;
  readonly call: PreparedContractCall | PreparedProtectedCall | PreparedTokenCall;
  readonly signerAccountId: string;
  readonly requestId: string;
  readonly termsHash: string;
  readonly terms?: IntentTerms;
  readonly operationNonce?: string;
  readonly signAndSend: (call: WalletCall) => Promise<SignOutcome>;
}): Promise<SubmitResult> {
  const { journal, call, signerAccountId } = input;
  // Without a journal an unknown outcome could not survive a reload, so the
  // duplicate brake would not work. Refuse rather than sign unprotected.
  if (journal === null || !journal.isReadable() || !journal.canBegin()) return { kind: 'no_journal' };

  const identity = { requestId: input.requestId, method: call.methodName as JournalMethod, signerAccountId };
  let target: JournalEntry;
  try {
    // Under the cross-tab journal lock: a concurrent attempt in another tab is
    // seen here and blocks this one before any wallet prompt.
    target = await journal.begin({
      ...identity,
      network: 'near-testnet',
      contractId: call.receiverId,
      termsHash: input.termsHash,
      terms: input.terms ?? null,
      operationNonce: input.operationNonce ?? null,
    });
  } catch (error) {
    if (error instanceof JournalBlockedError) return { kind: 'blocked', entry: error.entry };
    return { kind: 'no_journal' };
  }

  let outcome: SignOutcome;
  try {
    outcome = await input.signAndSend(call);
  } catch (error) {
    if (error instanceof WalletNotDispatchedError) {
      const saved = await record(journal, target, { phase: 'USER_REJECTED', notDispatched: true });
      if (!saved) return { kind: 'unknown' };
      if (error instanceof WalletDeclinedError) return { kind: 'rejected' };
      return error instanceof WalletNotSentError ? { kind: 'not_sent' } : { kind: 'wrong_account' };
    }
    await record(journal, target, { phase: 'OUTCOME_UNKNOWN' });
    return { kind: 'unknown' };
  }

  if (outcome.kind === 'submitted') {
    // If the hash cannot be recorded, the entry stays AWAITING_SIGNATURE (blocking);
    // report the outcome as unknown rather than as a clean submission.
    const saved = await record(journal, target, { phase: 'SUBMITTED', transactionHash: outcome.transactionHash });
    return saved ? outcome : { kind: 'unknown', transactionHash: outcome.transactionHash };
  }
  await record(journal, target, { phase: 'OUTCOME_UNKNOWN', ...(outcome.transactionHash ? { transactionHash: outcome.transactionHash } : {}) });
  return outcome;
}

/** Records an outcome. A failed write leaves the earlier blocking phase in place. */
async function record(
  journal: SubmissionJournal,
  target: Pick<JournalEntry, 'requestId' | 'method' | 'signerAccountId' | 'startedAt'>,
  change: Parameters<SubmissionJournal['update']>[1],
): Promise<boolean> {
  try {
    await journal.update(target, change);
    return true;
  } catch {
    return false;
  }
}

export type Reconciliation =
  /** The chain explains the attempt. It no longer blocks anything. */
  | 'resolved'
  /** Not explained yet. New attempts stay blocked. */
  | 'pending';

/**
 * Decides what a finalized read says about an earlier attempt.
 *
 * `observedAtNs` is the chain time of that read; `startedAtNs` is when the
 * attempt began (wall clock converted to ns). If the chain read is older than the
 * attempt, nothing can be concluded.
 */
export function reconcile(entry: JournalEntry, view: PaymentView, startedAtNs: bigint): Reconciliation {
  if (!isBlocking(entry)) return 'resolved';
  if (view.kind !== 'ok' && view.kind !== 'not_found') return 'pending';
  const observedAtNs = BigInt(view.observedAtNs);
  if (observedAtNs < startedAtNs) return 'pending';
  if (view.kind === 'ok') {
    const observation = view.response.observation;
    if (observation.source !== 'rpc' || observation.assurance !== 'verified_final' || observation.stale || !observation.rpcAvailable) return 'pending';
  }

  if (entry.method === 'create_request') {
    if (view.kind === 'ok') return 'resolved';
    // The contract refuses a creation at or after its funding expiry
    // (IntentTerms::validate requires expiry > block time). A verified final
    // read at/after that expiry that still finds nothing proves this attempt
    // can never take effect, e.g. a creation the merchant declined in the wallet.
    const terms = entry.terms;
    if (view.verifiedFinal === true && terms !== null && terms.id === entry.requestId &&
      observedAtNs >= BigInt(terms.fundingExpiresAtNs)) return 'resolved';
    return 'pending';
  }

  if (view.kind !== 'ok') return 'pending';
  const { request } = view;

  switch (entry.method) {
    case 'pay_instant_native':
      // Funded or cancelled by anyone: this request can no longer be funded twice.
      if (request.status !== 'OPEN') return 'resolved';
      // Still OPEN at a final block at/after expiry: no funding can ever succeed,
      // so the attempt provably had no effect (the contract refunds a late deposit).
      if (observedAtNs >= BigInt(request.terms.fundingExpiresAtNs)) return 'resolved';
      return 'pending';
    case 'cancel_unfunded':
      // An expired OPEN request can still be cancelled, so only a state change explains this.
      if (request.status !== 'OPEN') return 'resolved';
      return 'pending';
    case 'retry_native_transfer': {
      const op = request.latestOperation;
      // A newer operation, or no longer failed: the retry was used or superseded.
      // Covers Instant payouts and Protected refund/release retries alike.
      if (!request.status.endsWith('_FAILED_RECOVERABLE') || op === null || op.nonce !== entry.operationNonce) {
        return 'resolved';
      }
      return 'pending';
    }
    case 'fund_protected_native':
      // Locked or cancelled by anyone: this request can no longer be funded twice.
      if (request.status !== 'OPEN') return 'resolved';
      if (observedAtNs >= BigInt(request.terms.fundingExpiresAtNs)) return 'resolved';
      return 'pending';
    case 'ft_transfer_call':
      // Token funding: same rule as native funding. A refused transfer is returned by the token.
      if (request.status !== 'OPEN') return 'resolved';
      if (observedAtNs >= BigInt(request.terms.fundingExpiresAtNs)) return 'resolved';
      return 'pending';
    case 'cancel_protected':
      // A branch was committed (refund or release), so this attempt is explained.
      if (request.status !== 'LOCKED') return 'resolved';
      // Still LOCKED at a final block at/after the cutoff: the contract refuses any
      // cancellation from now on, so the attempt can never take effect.
      if (request.cancelUntilNs !== null && observedAtNs >= BigInt(request.cancelUntilNs)) return 'resolved';
      return 'pending';
    case 'release_protected':
      // Release has no deadline: only a committed branch explains the attempt.
      if (request.status !== 'LOCKED') return 'resolved';
      return 'pending';
    default:
      return 'pending';
  }
}

export function dateToNs(iso: string): bigint {
  return BigInt(Date.parse(iso)) * 1_000_000n;
}
