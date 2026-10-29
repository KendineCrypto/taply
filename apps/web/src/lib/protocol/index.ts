/**
 * Single import surface for protocol types.
 *
 * At integration this file re-points to `@taply/shared` (Codex-owned) and the
 * sibling modules are deleted. No other file in apps/web may declare a protocol
 * type - see ./README.md.
 */
export {
  ASSURANCES,
  CHAIN_STATES,
  LOCAL_WALLET_PHASES,
  PAY_MODES,
  ROLES,
  SESSION_STATES,
  isVerifiedPaid,
} from './chain-state';

export type {
  Assurance,
  ChainState,
  LocalWalletPhase,
  PayMode,
  Role,
  SessionState,
} from './chain-state';

export { NEAR_NATIVE } from './types';

export type {
  Asset,
  AssetId,
  ChainObservation,
  DecimalString,
  DerivedProjection,
  HandshakeSession,
  IntentTerms,
  MerchantProfile,
  Network,
  ObservedBlock,
  PaymentIntent,
  PaymentIntentResponse,
  VerifiedReceipt,
} from './types';

export {
  RETRY_ACTIONS,
  TAPLY_ERROR_CODES,
  UNKNOWN_OUTCOME_CODES,
  isAutoRetryableRead,
  isUnknownOutcome,
  toErrorCode,
} from './errors';

export type { ApiError, RetryAction, TaplyErrorCode } from './errors';
