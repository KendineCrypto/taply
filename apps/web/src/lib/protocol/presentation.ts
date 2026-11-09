import {
  CallerRoleSchema,
  ERROR_CODES,
  LocalWalletStateSchema,
  PayModeSchema,
} from '@taply/shared';
import type { ChainObservation, ErrorCode, LocalWalletState, OperationKind, CallerRole } from '@taply/shared';

/**
 * Frontend-only additions on top of `@taply/shared`.
 *
 * Nothing here redefines a protocol value. Each export exists for one of three
 * reasons, stated per item:
 *   (a) the shared package has the union but no iterable list, and the UI needs
 *       to render one entry per member;
 *   (b) it is presentation metadata the protocol has no opinion about;
 *   (c) it is a defence-in-depth predicate that restates a rule the shared
 *       schema already enforces, so a malformed response cannot reach a control.
 */

// --- (a) Iterable lists derived from shared unions ---------------------------

/** Zod enums expose `.options`, so these lists cannot drift from the schema. */
export const CALLER_ROLES = CallerRoleSchema.options;
export const PAY_MODES = PayModeSchema.options;

export type Assurance = ChainObservation<unknown>['assurance'];
export type ObservationSource = ChainObservation<unknown>['source'];

/**
 * `assurance` and `source` are declared inline inside the shared observation
 * schema, so there is no `.options` array to borrow. These `Record` maps are
 * keyed by the shared union: omitting a member fails to compile, and adding one
 * that does not exist fails too. That is the drift guard.
 */
const ASSURANCE_MEMBERS: Record<Assurance, true> = {
  unverified: true,
  pending_finality: true,
  verified_final: true,
  unknown: true,
  mismatch: true,
};
export const ASSURANCES = Object.keys(ASSURANCE_MEMBERS) as ReadonlyArray<Assurance>;

const OBSERVATION_SOURCE_MEMBERS: Record<ObservationSource, true> = {
  rpc: true,
  index: true,
  mock: true,
};
export const OBSERVATION_SOURCES = Object.keys(
  OBSERVATION_SOURCE_MEMBERS,
) as ReadonlyArray<ObservationSource>;

/**
 * Local wallet phases.
 *
 * `@taply/shared` defines the three that matter to the protocol
 * (AWAITING_SIGNATURE, USER_REJECTED, OUTCOME_UNKNOWN). The UI needs three more
 * purely local ones to drive a screen. They are a strict superset, and none of
 * them can express a settlement outcome - there is no member meaning paid,
 * funded or verified, by construction.
 */
export type LocalPhase = LocalWalletState | 'IDLE' | 'REVIEWING' | 'SUBMITTED';

export const LOCAL_PHASES: ReadonlyArray<LocalPhase> = [
  'IDLE',
  'REVIEWING',
  ...LocalWalletStateSchema.options.filter((phase) => phase === 'AWAITING_SIGNATURE'),
  'SUBMITTED',
  ...LocalWalletStateSchema.options.filter((phase) => phase !== 'AWAITING_SIGNATURE'),
];

// --- (b) Presentation metadata ----------------------------------------------

/**
 * Display metadata for the one supported asset.
 *
 * The protocol only carries `assetId: 'near:native'`; decimal precision is a
 * formatting concern, so it lives here rather than in the wire model. 24 is the
 * fixed yoctoNEAR exponent.
 */
export interface DisplayAsset {
  /** `near:native` or `nep141:<token account>` (shared schema v1.1). */
  readonly id: string;
  /** Token symbols come ONLY from a contract's verified allowlist, never from the token itself. */
  readonly symbol: string;
  readonly decimals: number;
}

export const NEAR_NATIVE: DisplayAsset = { id: 'near:native', symbol: 'NEAR', decimals: 24 };

// --- (c) Defence-in-depth predicates ----------------------------------------

/**
 * The ONLY combination that may receive a verified-paid treatment.
 *
 * Freeze section 9: "Only FINAL_PAID + verified_final may get a Verified Paid
 * ribbon." The shared schema separately guarantees a mock observation cannot
 * claim `verified_final`; callers still pass `source` so the UI refuses even if
 * an unvalidated object reaches it.
 */
export function isVerifiedPaid(
  state: string,
  assurance: Assurance,
  source: ObservationSource,
): boolean {
  return state === 'FINAL_PAID' && assurance === 'verified_final' && source !== 'mock';
}

/**
 * Restates `PaymentIntentResponseSchema`'s retry rule locally: a refund retry
 * belongs to the payer, any payout/release retry to the recipient, and a caller
 * who is both may do either. Without this, a response that skipped validation
 * could surface a retry button to the wrong party.
 */
export function retryRoleMatchesKind(role: CallerRole, kind: OperationKind): boolean {
  if (role === 'payer_and_recipient') return true;
  return role === (kind === 'PROTECTED_REFUND' ? 'payer' : 'recipient');
}

/**
 * Error codes whose real outcome is unknown or still settling. No new payment
 * may be offered for these and nothing may be retried automatically (freeze
 * sections 4, 8, 9 and lead decision 9).
 *
 * The shared `ApiErrorSchema` already forces `retryAction: 'WAIT_AND_RECONCILE'`
 * for exactly this set, so the two definitions are checked against each other in
 * `src/lib/protocol/__tests__/shared-compat.test.ts`.
 */
export const UNKNOWN_OUTCOME_CODES: ReadonlyArray<ErrorCode> = [
  'RPC_TIMEOUT_UNKNOWN_STATUS',
  'CALLBACK_FAILED',
  'RECONCILIATION_REQUIRED',
  'OPERATION_IN_FLIGHT',
];

export function isUnknownOutcome(code: ErrorCode): boolean {
  return UNKNOWN_OUTCOME_CODES.includes(code);
}

/**
 * Whether the UI may re-issue a request with no user action. Only idempotent
 * reads qualify; no signing action is ever auto-retried.
 */
export function isAutoRetryableRead(code: ErrorCode): boolean {
  return (
    code === 'RATE_LIMITED' ||
    code === 'RPC_UNAVAILABLE' ||
    code === 'INDEX_UNAVAILABLE' ||
    code === 'VERIFICATION_UNAVAILABLE' ||
    code === 'CONTRACT_UNAVAILABLE'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as ReadonlyArray<string>).includes(value);
}

/**
 * Narrows an unknown payload to a known error code, defaulting to a safe
 * generic. Any server-supplied prose is deliberately discarded: display copy
 * always comes from the local dictionary, keyed by code (freeze section 8).
 */
export function toErrorCode(payload: unknown): ErrorCode {
  if (!isRecord(payload)) return 'INVALID_ARGUMENT';
  const error = payload['error'];
  if (!isRecord(error)) return 'INVALID_ARGUMENT';
  return isErrorCode(error['code']) ? error['code'] : 'INVALID_ARGUMENT';
}
