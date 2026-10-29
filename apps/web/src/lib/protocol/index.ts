/**
 * Single protocol import surface for apps/web.
 *
 * Phase 0.5: the temporary local mirror is GONE. Every payment state, transport
 * model, schema and hash function now comes from `@taply/shared` (Codex-owned).
 * This file re-exports that package and nothing else; anything genuinely
 * frontend-only lives in `./presentation.ts` and is clearly marked as such.
 *
 * There is exactly one definition of ChainState, CallerRole, ErrorCode and the
 * hashing domains in this repository, and it is not here.
 */

// --- Versions and wire constants -------------------------------------------
export {
  API_PREFIX,
  API_VERSION,
  CONTRACT_EVENT_VERSION,
  DYNAMIC_RESPONSE_HEADERS,
  INTENT_VERSION,
} from '@taply/shared';

// --- Numeric and duration bounds -------------------------------------------
export {
  DEFAULT_CANCEL_DURATION_NS,
  DEFAULT_FUNDING_LIFETIME_NS,
  MAX_CANCEL_DURATION_NS,
  MAX_FUNDING_LIFETIME_NS,
  MAX_PROTOCOL_JSON_BYTES,
  MAX_PROTOCOL_JSON_DEPTH,
  MIN_CANCEL_DURATION_NS,
  U128_MAX,
  U64_MAX,
} from '@taply/shared';

// --- Enum value arrays ------------------------------------------------------
export { CHAIN_STATES, ERROR_CODES, SESSION_STATES } from '@taply/shared';

// --- Canonical hashing and strict JSON --------------------------------------
// Never reimplemented here: freeze section 7 forbids deriving a second algorithm.
export {
  calculateRequestId,
  calculateSessionCommitment,
  calculateTermsHash,
  canonicalJson,
  comparisonCode,
  domainHash,
  parseIntentTermsJson,
  parseStrictJson,
} from '@taply/shared';

// --- Schemas ----------------------------------------------------------------
export {
  AccountIdSchema,
  AmountSchema,
  ApiErrorSchema,
  AssetIdSchema,
  BlockRefSchema,
  CallerRoleSchema,
  ChainHashSchema,
  ChainStateSchema,
  ComparisonCodeSchema,
  ContractRequestSchema,
  DerivedPaymentActionsSchema,
  ErrorCodeSchema,
  HandshakeSessionSchema,
  HashHexSchema,
  IntentIdentitySchema,
  IntentTermsSchema,
  LocalWalletStateSchema,
  MerchantProfileSchema,
  NetworkSchema,
  OperationKindSchema,
  OperationRecordSchema,
  PayModeSchema,
  PaymentIntentResponseSchema,
  PositiveU64Schema,
  RetryActionSchema,
  SessionEventSchema,
  SessionIdSchema,
  SessionReviewSchema,
  SessionStateSchema,
  U128Schema,
  U64Schema,
  UtcDateTimeSchema,
  VerificationDiagnosticSchema,
  VerifiedReceiptSchema,
  createChainObservationSchema,
  createCursorPageSchema,
} from '@taply/shared';

// --- Contract call argument shapes ------------------------------------------
// Argument validation only. Not a transaction builder and not authority.
export { ContractMethodArgs } from '@taply/shared';

// --- Phase 0 capability truth -----------------------------------------------
// Codex's authoritative statement that nothing is enabled yet.
export { PHASE_0_CAPABILITIES, PHASE_0_CONFIG } from '@taply/shared';

// --- Types ------------------------------------------------------------------
export type {
  AccountId,
  ApiError,
  BlockRef,
  CallerRole,
  ChainObservation,
  ChainState,
  ContractRequest,
  CursorPage,
  DerivedPaymentActions,
  ErrorCode,
  HandshakeSession,
  HashHex,
  IntentIdentity,
  IntentTerms,
  LocalWalletState,
  MerchantProfile,
  Network,
  OperationKind,
  OperationRecord,
  PayMode,
  PaymentIntentResponse,
  ReceiptOutcomeRef,
  RetryAction,
  SessionBinding,
  SessionEvent,
  SessionState,
  TransactionHint,
  TransactionRef,
  U128,
  U64,
  VerifiedReceipt,
} from '@taply/shared';

// --- Frontend-only presentation helpers -------------------------------------
// Not protocol. See ./presentation.ts for why each one exists.
export {
  ASSURANCES,
  CALLER_ROLES,
  LOCAL_PHASES,
  NEAR_NATIVE,
  OBSERVATION_SOURCES,
  PAY_MODES,
  UNKNOWN_OUTCOME_CODES,
  isAutoRetryableRead,
  isUnknownOutcome,
  isVerifiedPaid,
  retryRoleMatchesKind,
  toErrorCode,
} from './presentation';

export type { Assurance, DisplayAsset, LocalPhase, ObservationSource } from './presentation';
