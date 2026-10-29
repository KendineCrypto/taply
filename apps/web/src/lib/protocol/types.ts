import type { Assurance, ChainState, PayMode, Role, SessionState } from './chain-state';

/**
 * Canonical decimal strings (freeze section 3): amounts, nanosecond timestamps,
 * heights, counters and operation nonces. NEVER a JS number.
 */
export type DecimalString = string;

export type Network = 'near-testnet';

/** Freeze section 3: asset is near:native only for v0.4. */
export type AssetId = 'near:native';

export interface Asset {
  readonly id: AssetId;
  readonly symbol: 'NEAR';
  readonly decimals: 24;
}

export const NEAR_NATIVE: Asset = { id: 'near:native', symbol: 'NEAR', decimals: 24 };

export interface ObservedBlock {
  readonly hash: string;
  readonly height: DecimalString;
  readonly timestampNs: DecimalString;
}

/**
 * The single public payment read envelope (freeze section 3). There is no
 * competing ReadEnvelope type.
 *
 * stale and rpcAvailable are independent of assurance: a final receipt can stay
 * historically verified while live RPC is unavailable.
 */
export interface ChainObservation<T> {
  readonly data: T;
  readonly source: 'chain' | 'index' | 'mock';
  readonly assurance: Assurance;
  readonly observedBlock: ObservedBlock | null;
  readonly checkedAt: string;
  readonly stale: boolean;
  readonly rpcAvailable: boolean;
  /**
   * Typed verification diagnostic; never a replacement for chain data
   * (freeze section 8). Must not be displayed automatically.
   */
  readonly mismatchDetail?: ReadonlyArray<{ field: string; observed: string; expected: string }>;
}

/**
 * Immutable terms. termsHash identifies terms, NOT current payment status
 * (freeze section 3).
 */
export interface IntentTerms {
  readonly requestId: string;
  readonly network: Network;
  readonly contractId: string;
  readonly mode: PayMode;
  /** Freeze section 4: recipient-created requests, so creator === recipient. */
  readonly creatorAccountId: string;
  readonly recipientAccountId: string;
  readonly assetId: AssetId;
  readonly amountBaseUnits: DecimalString;
  readonly creationNonce: DecimalString;
  readonly createdAtNs: DecimalString;
  readonly fundingExpiresAtNs: DecimalString | null;
  /** Protected only. 60-3600s, default 60s. Immutable, signed by recipient. */
  readonly cancelDurationNs: DecimalString | null;
  readonly merchantAccountId: string | null;
  readonly invoiceNumber: string | null;
  readonly sessionCommitment: string | null;
}

export interface PaymentIntent {
  readonly terms: IntentTerms;
  readonly termsHash: string;
  readonly status: ChainState;
  readonly payerAccountId: string | null;
  /** Null before funding. Set by the contract at funding execution. */
  readonly fundedAtNs: DecimalString | null;
  /** Null before funding. fundedAtNs + cancelDurationNs, chain-computed. */
  readonly cancelUntilNs: DecimalString | null;
  readonly operationNonce: DecimalString | null;
  readonly fundingTxHash: string | null;
  readonly settlementTxHash: string | null;
  readonly version: DecimalString;
}

/**
 * Derived UI projection (freeze section 3) - NOT authoritative on-chain data.
 * "Access to actions must be checked again in the contract; UI flags do not
 * grant authority."
 */
export interface DerivedProjection {
  /** Funding eligibility expiry; applies only to unfunded OPEN requests. */
  readonly expired: boolean;
  /** Null when the mode has no cancel window, or the request is not funded. */
  readonly cancelWindowOpen: boolean | null;
  readonly releaseEligible: boolean | null;
  readonly retry: {
    readonly allowed: boolean;
    readonly authorizedRoles: ReadonlyArray<Role>;
  } | null;
  readonly callerRole: Role;
}

export interface PaymentIntentResponse {
  readonly schemaVersion: 'taply.api.v1';
  readonly observation: ChainObservation<PaymentIntent>;
  readonly derived: DerivedProjection;
}

export interface HandshakeSession {
  readonly id: string;
  readonly state: SessionState;
  readonly requestId: string | null;
  readonly merchantAccountId: string | null;
  readonly sessionNonce: string;
  /** Human comparison aid only; may collide. Never identity proof. */
  readonly comparisonCode: string;
  readonly expiresAt: string;
  readonly presence: ReadonlyArray<{ role: Role; lastSeenAt: string }>;
}

export interface VerifiedReceipt {
  readonly requestId: string;
  readonly mode: PayMode;
  readonly finalStatus: 'FINAL_PAID' | 'CANCELLED_REFUNDED';
  readonly network: Network;
  readonly contractId: string;
  readonly payerAccountId: string;
  readonly recipientAccountId: string;
  readonly asset: Asset;
  readonly amountBaseUnits: DecimalString;
  /** Top-level transaction hashes - distinct from internal receipt ids. */
  readonly fundingTxHash: string;
  readonly settlementTxHash: string;
  /** Internal receipt ids for the payout/refund transfer and its callback. */
  readonly settlementReceiptIds: ReadonlyArray<string>;
  readonly observation: ChainObservation<null>;
}

export interface MerchantProfile {
  /** Freeze section 5: account-derived URL, slug === accountId. */
  readonly accountId: string;
  readonly displayName: string;
  readonly network: Network;
  readonly contractId: string;
  readonly origin: string;
  readonly signatureExpiresAt: string;
  /** Demonstrates account control, NOT legal business identity or KYC. */
  readonly binding: 'account_controlled' | 'unverified';
}
