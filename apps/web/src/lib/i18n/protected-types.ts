import type { ErrorCopy } from './types';

/** Protected Pay (G3 candidate) screens: /protected/new and /protected/[id]. */
export interface ProtectedFlowCopy {
  readonly title: string;
  readonly newTitle: string;
  readonly intro: string;
  readonly notEnabled: ErrorCopy;
  readonly notConfigured: ErrorCopy;
  readonly invalidConfig: ErrorCopy;
  readonly pilotRefused: ErrorCopy;
  readonly unreviewed: ErrorCopy;
  readonly contractChecking: string;
  readonly contractBlocked: ErrorCopy;
  readonly walletNeeded: ErrorCopy;
  readonly readFailed: ErrorCopy;
  readonly notFound: ErrorCopy;
  readonly wrongContract: ErrorCopy;
  readonly inconsistent: ErrorCopy;
  readonly staleReview: ErrorCopy;
  readonly refused: ErrorCopy;
  readonly consentTitle: string;
  /** `{duration}` is replaced with the signed cancellation window. */
  readonly consentWithDuration: string;
  readonly consentCheckbox: string;
  readonly payerRightsTitle: string;
  readonly lockAction: string;
  readonly cancelAction: string;
  readonly releaseAction: string;
  readonly retryRefundAction: string;
  readonly retryReleaseAction: string;
  readonly cutoffOnChain: string;
  /** `{time}` is m:ss. */
  readonly countdown: string;
  readonly countdownReached: string;
  readonly cancelHint: string;
  readonly inFlightNote: string;
  readonly incident: ErrorCopy;
  readonly refunded: ErrorCopy;
  readonly released: ErrorCopy;
  readonly expired: ErrorCopy;
  readonly fields: {
    readonly amount: string;
    readonly recipient: string;
    readonly payer: string;
    readonly window: string;
    readonly fundingDeadline: string;
    readonly status: string;
  };
  readonly duration: { readonly seconds: string; readonly minutes: string; readonly hours: string };
  readonly create: {
    readonly amountLabel: string;
    readonly amountHint: string;
    readonly windowLabel: string;
    readonly windowHint: string;
    readonly payerLabel: string;
    readonly payerHint: string;
    readonly createAction: string;
    readonly storageNote: string;
    readonly quoteFailed: ErrorCopy;
    readonly created: string;
    readonly openRequest: string;
    readonly errors: {
      readonly amount_required: string;
      readonly amount_invalid: string;
      readonly amount_zero: string;
      readonly memo_too_long: string;
      readonly payer_invalid: string;
      readonly payer_is_recipient: string;
    };
  };
}
