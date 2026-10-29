import { CHAIN_STATES, NEAR_NATIVE } from '@/lib/protocol';
import type {
  Assurance,
  CallerRole,
  ChainState,
  DerivedPaymentActions,
  ObservationSource,
  PaymentIntentResponse,
} from '@/lib/protocol';

/**
 * MOCK FIXTURES - /demo only.
 *
 * Invented values for visual review. They are NOT Testnet evidence, and no
 * identifier below is a real transaction, account or contract.
 *
 * Two protocol rules from `@taply/shared` are respected here rather than worked
 * around, because the point of the demo is to show the real behaviour:
 *
 *  1. `createChainObservationSchema`: "Mock data cannot claim chain
 *     verification" - a `mock` source forces `assurance: 'unverified'` and a
 *     null `observedBlock`. So `mockObservation` pins assurance when the source
 *     is mock, and the demo cannot select an impossible pairing.
 *  2. `PaymentIntentResponseSchema`: "Uncertain/mock/stale observations cannot
 *     enable financial actions" - so a mock observation yields no cancel,
 *     release, retry or pay affordance at all. That is the correct outcome, not
 *     a gap in the demo.
 */

export const MOCK_ACCOUNT_PAYER = 'mock-payer.testnet';
export const MOCK_ACCOUNT_RECIPIENT = 'mock-merchant.testnet';
export const MOCK_ASSET = NEAR_NATIVE;

/** 1.25 NEAR in yoctoNEAR. */
export const MOCK_AMOUNT_BASE_UNITS = '1250000000000000000000000';

export interface MockObservationFacts {
  readonly assurance: Assurance;
  readonly source: ObservationSource;
  readonly stale: boolean;
  readonly rpcAvailable: boolean;
}

/**
 * Builds observation facts that a real `ChainObservation` could actually hold.
 * A mock source is pinned to `unverified`, exactly as the shared schema requires.
 */
export function mockObservation(
  assurance: Assurance,
  source: ObservationSource = 'mock',
): MockObservationFacts {
  return {
    assurance: source === 'mock' ? 'unverified' : assurance,
    source,
    stale: false,
    rpcAvailable: true,
  };
}

const EMPTY_RETRY = { eligible: false, operationNonce: null, kind: null } as const;

/**
 * A derived projection that is internally consistent for the given state, so the
 * demo exercises realistic gating rather than a permissive worst case.
 *
 * Note that these flags only produce a visible affordance when the observation
 * is actionable; with a mock source none of them can.
 */
export function mockDerived(state: ChainState, callerRole: CallerRole): DerivedPaymentActions {
  const base: DerivedPaymentActions = {
    callerRole,
    cancelWindowOpen: null,
    releaseEligible: null,
    retry: EMPTY_RETRY,
  };

  if (state === 'LOCKED') {
    // Cancel window open, release therefore not yet eligible - never both.
    return { ...base, cancelWindowOpen: true, releaseEligible: false };
  }

  if (state === 'PAYOUT_FAILED_RECOVERABLE' || state === 'RELEASE_FAILED_RECOVERABLE') {
    // Freeze section 4: a payout/release retry belongs to the recipient.
    return {
      ...base,
      retry: { eligible: true, operationNonce: '1', kind: 'PROTECTED_RELEASE' },
    };
  }

  if (state === 'REFUND_FAILED_RECOVERABLE') {
    return { ...base, retry: { eligible: true, operationNonce: '1', kind: 'PROTECTED_REFUND' } };
  }

  return base;
}

/** The LOCKED-after-cutoff variant, which the per-state default cannot express. */
export function mockDerivedReleaseEligible(callerRole: CallerRole): DerivedPaymentActions {
  return {
    callerRole,
    cancelWindowOpen: false,
    releaseEligible: true,
    retry: EMPTY_RETRY,
  };
}

export function mockFundingEligibility(state: ChainState): PaymentIntentResponse['fundingEligibility'] {
  if (state === 'OPEN') return 'ELIGIBLE';
  return 'NOT_OPEN';
}

/** Every state, for the demo status matrix and visual regression baselines. */
export const MOCK_STATE_MATRIX: ReadonlyArray<ChainState> = CHAIN_STATES;
