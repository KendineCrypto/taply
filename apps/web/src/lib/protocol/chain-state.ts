/**
 * Contract-stored payment state. Frozen in Protocol Freeze v1 section 3.
 *
 * EXPIRED, FUNDING and DISCONNECTED are deliberately ABSENT - the freeze forbids
 * creating them as on-chain statuses. Expiry is a derived projection
 * (DerivedProjection.expired); disconnection is derived from session presence.
 */
export const CHAIN_STATES = [
  'OPEN',
  'CANCELLED_UNFUNDED',
  'PAYOUT_IN_FLIGHT',
  'PAYOUT_FAILED_RECOVERABLE',
  'LOCKED',
  'REFUND_IN_FLIGHT',
  'REFUND_FAILED_RECOVERABLE',
  'RELEASE_IN_FLIGHT',
  'RELEASE_FAILED_RECOVERABLE',
  'FINAL_PAID',
  'CANCELLED_REFUNDED',
] as const;

export type ChainState = (typeof CHAIN_STATES)[number];

/**
 * Local wallet state (freeze section 3) - a DIFFERENT enum from ChainState.
 * It cannot express a settlement outcome by construction: no member means paid,
 * funded or verified.
 */
export const LOCAL_WALLET_PHASES = [
  'IDLE',
  'REVIEWING',
  'AWAITING_SIGNATURE',
  'USER_REJECTED',
  'SUBMITTED',
  'OUTCOME_UNKNOWN',
] as const;

export type LocalWalletPhase = (typeof LOCAL_WALLET_PHASES)[number];

/** Handshake session state (freeze section 3). Not a payment state. */
export const SESSION_STATES = ['DRAFT', 'OPEN', 'PAIRED', 'REVIEWED', 'EXPIRED', 'CLOSED'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** Chain observation assurance (freeze section 3). */
export const ASSURANCES = [
  'unverified',
  'pending_finality',
  'verified_final',
  'unknown',
  'mismatch',
] as const;
export type Assurance = (typeof ASSURANCES)[number];

/** Milestone is disabled for v0.4 (freeze section 3). */
export const PAY_MODES = ['instant', 'protected'] as const;
export type PayMode = (typeof PAY_MODES)[number];

/** Caller role relative to an intent. Drives CTA presentation only. */
export const ROLES = ['payer', 'recipient', 'creator', 'observer'] as const;
export type Role = (typeof ROLES)[number];

/**
 * The ONLY combination in which a verified-paid treatment is permitted.
 * Freeze section 9: "Only FINAL_PAID + verified_final may get a Verified Paid
 * ribbon."
 */
export function isVerifiedPaid(state: ChainState, assurance: Assurance): boolean {
  return state === 'FINAL_PAID' && assurance === 'verified_final';
}
