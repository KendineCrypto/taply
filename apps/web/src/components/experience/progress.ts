import type { ChainState } from '@/lib/protocol';

/**
 * Payment progress stages for the Instant Pay journey.
 *
 * Only `verified` may use the success treatment, and only when an independent
 * receipt verification says so. `contract_paid` is what the contract reports:
 * it is shown as a calm, neutral state, never as Verified Paid.
 */
export type ProgressStage =
  | 'awaiting'
  | 'wallet'
  | 'transfer'
  | 'contract_paid'
  | 'verified'
  | 'failed'
  | 'unresolved'
  | 'cancelled';

export type StageTone = 'neutral' | 'caution' | 'success' | 'muted';

export const STAGE_TONE: Readonly<Record<ProgressStage, StageTone>> = {
  awaiting: 'neutral',
  wallet: 'caution',
  transfer: 'caution',
  contract_paid: 'neutral',
  verified: 'success',
  failed: 'caution',
  unresolved: 'caution',
  cancelled: 'muted',
};

export interface StageInput {
  readonly state: ChainState;
  /** An unresolved incident reported for an in-flight payout. */
  readonly incident: boolean;
  /** This device has a wallet window open for this request. */
  readonly walletPending: boolean;
  /** An independent receipt verification returned `verified` for this request. */
  readonly verified: boolean;
}

/** null = a state outside Instant Pay (e.g. Protected Pay); callers fall back to the status badge. */
export function progressStageFor({ state, incident, walletPending, verified }: StageInput): ProgressStage | null {
  switch (state) {
    case 'OPEN':
      return walletPending ? 'wallet' : 'awaiting';
    case 'PAYOUT_IN_FLIGHT':
      return incident ? 'unresolved' : 'transfer';
    case 'PAYOUT_FAILED_RECOVERABLE':
      return 'failed';
    case 'FINAL_PAID':
      return verified ? 'verified' : 'contract_paid';
    case 'CANCELLED_UNFUNDED':
      return 'cancelled';
    default:
      return null;
  }
}

export type StepKey = 'created' | 'approved' | 'transfer' | 'contract' | 'verified';
export type StepState = 'done' | 'current' | 'todo' | 'failed';
export const STEP_KEYS: ReadonlyArray<StepKey> = ['created', 'approved', 'transfer', 'contract', 'verified'];

/** Timeline: which of the five steps are done, current, pending or need attention. */
export function stepsFor(stage: ProgressStage): Readonly<Record<StepKey, StepState>> {
  const order: Record<ProgressStage, [number, StepState]> = {
    awaiting: [1, 'current'],
    wallet: [1, 'current'],
    transfer: [2, 'current'],
    failed: [2, 'failed'],
    unresolved: [2, 'failed'],
    contract_paid: [4, 'current'],
    verified: [5, 'done'],
    cancelled: [1, 'failed'],
  };
  const [reached, mark] = order[stage];
  const result = {} as Record<StepKey, StepState>;
  STEP_KEYS.forEach((key, index) => {
    if (index < reached) result[key] = 'done';
    else if (index === reached) result[key] = mark;
    else result[key] = 'todo';
  });
  // "Verified" is complete only when it is actually verified.
  if (stage === 'verified') result.verified = 'done';
  return result;
}
