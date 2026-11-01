import type { PreparedContractCall } from '@taply/near-client';
import type { IntentTerms } from '@/lib/protocol';
import { WalletError, classifyWalletError } from '@/lib/wallet/adapter';
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
  /** The wallet is connected as a different account. Nothing was sent. */
  | { readonly kind: 'wrong_account' }
  /** An earlier attempt for this request is still unexplained. Nothing was sent. */
  | { readonly kind: 'blocked'; readonly entry: JournalEntry }
  /** No usable journal (storage disabled or corrupted). Nothing was sent. */
  | { readonly kind: 'no_journal' };

export async function submitCall(input: {
  readonly journal: SubmissionJournal | null;
  readonly call: PreparedContractCall;
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
    const kind = error instanceof WalletError ? error.kind : classifyWalletError(error);
    if (kind === 'cancelled') {
      await record(journal, target, { phase: 'USER_REJECTED' });
      return { kind: 'rejected' };
    }
    if (kind === 'no_account') {
      await record(journal, target, { phase: 'USER_REJECTED' });
      return { kind: 'wrong_account' };
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

/** How long a hash-less unknown attempt blocks a new one, measured in chain time. */
export const UNKNOWN_ATTEMPT_HOLD_NS = 120_000_000_000n; // 2 minutes

export type Reconciliation =
  /** The chain explains the attempt. It no longer blocks anything. */
  | 'resolved'
  /** Not explained yet. New attempts stay blocked. */
  | 'pending'
  /**
   * Still unexplained, but long enough ago that a person may deliberately review
   * and try again. Safe because the contract accepts one funding, consumes each
   * creation nonce once and checks the retry nonce: a late duplicate is rejected
   * on chain and NEAR refunds its deposit (sandbox-verified). It is never automatic.
   */
  | 'may_reattempt';

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
  const waitedLongEnough = observedAtNs - startedAtNs >= UNKNOWN_ATTEMPT_HOLD_NS;

  if (entry.method === 'create_request') {
    if (view.kind === 'ok') return 'resolved';
    return waitedLongEnough ? 'may_reattempt' : 'pending';
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
      return waitedLongEnough ? 'may_reattempt' : 'pending';
    case 'cancel_unfunded':
      // An expired OPEN request can still be cancelled, so only a state change explains this.
      if (request.status !== 'OPEN') return 'resolved';
      return waitedLongEnough ? 'may_reattempt' : 'pending';
    case 'retry_native_transfer': {
      const op = request.latestOperation;
      // A newer operation, or no longer failed: the retry was used or superseded.
      if (request.status !== 'PAYOUT_FAILED_RECOVERABLE' || op === null || op.nonce !== entry.operationNonce) {
        return 'resolved';
      }
      return waitedLongEnough ? 'may_reattempt' : 'pending';
    }
    default:
      return 'pending';
  }
}

export function dateToNs(iso: string): bigint {
  return BigInt(Date.parse(iso)) * 1_000_000n;
}
