/**
 * API error contract (freeze section 8).
 *
 * ApiError { schemaVersion, error: { code, messageKey, requestId, retryAction,
 * retryAfterMs, details } }
 *
 * The frontend maps LOCALIZED KEYS and must never render untrusted raw server
 * prose. messageKey from the server is advisory only; display copy always comes
 * from the local dictionary keyed by `code`.
 */

export const TAPLY_ERROR_CODES = [
  'WRONG_NETWORK',
  'INVALID_ACCOUNT',
  'INVALID_ASSET',
  'INVALID_AMOUNT',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_GAS',
  'AUTH_REQUIRED',
  'WALLET_NOT_READY',
  'SOCIAL_LOGIN_NOT_TESTNET_CAPABLE',
  'USER_REJECTED',
  'REQUEST_EXPIRED',
  'REQUEST_ALREADY_FUNDED',
  'REQUEST_ALREADY_SETTLED',
  'WINDOW_STILL_OPEN',
  'CANCEL_WINDOW_CLOSED',
  'REFUND_IN_FLIGHT',
  'PAYOUT_IN_FLIGHT',
  'REFUND_FAILED',
  'PAYOUT_FAILED',
  'UNVERIFIED_MERCHANT',
  'SESSION_EXPIRED',
  'SESSION_MISMATCH',
  'NETWORK_UNAVAILABLE',
  'RPC_TIMEOUT_UNKNOWN_STATUS',
  'RATE_LIMITED',
  'RECEIPT_NOT_FINAL',
  'TERMS_CHANGED',
  'MERCHANT_NOT_FOUND',
  'MERCHANT_ACCOUNT_MISMATCH',
  'RETRY_NOT_AUTHORIZED',
  'CLOCK_UNAVAILABLE',
  'UNKNOWN_ERROR',
] as const;

export type TaplyErrorCode = (typeof TAPLY_ERROR_CODES)[number];

/**
 * Freeze section 8 names WAIT_AND_RECONCILE explicitly and requires that
 * RPC_TIMEOUT_UNKNOWN_STATUS maps to it rather than to a new payment.
 * The remaining members are this adapter's assumption - see protocol/README.md.
 */
export const RETRY_ACTIONS = [
  'NONE',
  'WAIT_AND_RECONCILE',
  'RETRY_SAME_BRANCH',
  'RE_REVIEW',
  'RETRY_READ',
] as const;

export type RetryAction = (typeof RETRY_ACTIONS)[number];

export interface ApiError {
  readonly schemaVersion: 'taply.api.v1';
  readonly error: {
    readonly code: TaplyErrorCode;
    readonly messageKey: string;
    readonly requestId: string;
    readonly retryAction: RetryAction;
    readonly retryAfterMs?: number;
    readonly details?: unknown;
  };
}

/**
 * Codes whose outcome is genuinely unknown. A new payment MUST NOT be offered
 * and nothing may be retried automatically (freeze sections 4, 8 and 9).
 */
export const UNKNOWN_OUTCOME_CODES: ReadonlyArray<TaplyErrorCode> = [
  'RPC_TIMEOUT_UNKNOWN_STATUS',
  'PAYOUT_IN_FLIGHT',
  'REFUND_IN_FLIGHT',
];

export function isUnknownOutcome(code: TaplyErrorCode): boolean {
  return UNKNOWN_OUTCOME_CODES.includes(code);
}

/**
 * Whether the UI may auto-retry WITHOUT user action. Only idempotent reads
 * qualify; no signing action is ever auto-retried.
 */
export function isAutoRetryableRead(code: TaplyErrorCode): boolean {
  return code === 'NETWORK_UNAVAILABLE' || code === 'RATE_LIMITED' || code === 'CLOCK_UNAVAILABLE';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrorCode(value: unknown): value is TaplyErrorCode {
  return typeof value === 'string' && (TAPLY_ERROR_CODES as ReadonlyArray<string>).includes(value);
}

/**
 * Narrows an unknown server payload to a known error code, defaulting to
 * UNKNOWN_ERROR. Deliberately ignores any server-supplied prose.
 */
export function toErrorCode(payload: unknown): TaplyErrorCode {
  if (!isRecord(payload)) return 'UNKNOWN_ERROR';
  const error = payload['error'];
  if (!isRecord(error)) return 'UNKNOWN_ERROR';
  return isErrorCode(error['code']) ? error['code'] : 'UNKNOWN_ERROR';
}
