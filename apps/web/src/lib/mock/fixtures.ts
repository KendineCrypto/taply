import { CHAIN_STATES, NEAR_NATIVE } from '@/lib/protocol';
import type { Assurance, ChainState, DerivedProjection, Role } from '@/lib/protocol';

/**
 * MOCK FIXTURES — /demo only.
 *
 * Every observation here carries `source: 'mock'`, which:
 *   - forces `verifiedRibbon` to false inside mapChainState, and
 *   - makes lib/mock/guard.ts refuse to render it outside /demo.
 *
 * These values are invented for visual review. They are NOT Testnet evidence and
 * no identifier below is a real transaction, account or contract.
 */

export const MOCK_ACCOUNT_PAYER = 'mock-payer.testnet';
export const MOCK_ACCOUNT_RECIPIENT = 'mock-merchant.testnet';
export const MOCK_ASSET = NEAR_NATIVE;

/** 1.25 NEAR in yoctoNEAR. */
export const MOCK_AMOUNT_BASE_UNITS = '1250000000000000000000000';

export function mockObservation(assurance: Assurance) {
  return {
    assurance,
    source: 'mock' as const,
    stale: false,
    rpcAvailable: true,
  };
}

/**
 * A derived projection that is internally consistent for the given state, so the
 * demo exercises realistic CTA gating rather than the permissive worst case.
 */
export function mockDerived(state: ChainState, role: Role): DerivedProjection {
  const base = {
    expired: false,
    cancelWindowOpen: null,
    releaseEligible: null,
    retry: null,
    callerRole: role,
  } satisfies DerivedProjection;

  if (state === 'LOCKED') {
    // Cancel window open, release therefore not yet eligible - never both.
    return { ...base, cancelWindowOpen: true, releaseEligible: false };
  }

  if (
    state === 'PAYOUT_FAILED_RECOVERABLE' ||
    state === 'RELEASE_FAILED_RECOVERABLE' ||
    state === 'REFUND_FAILED_RECOVERABLE'
  ) {
    // Freeze section 4: Instant retry is recipient-only, same destination.
    const roles: ReadonlyArray<Role> =
      state === 'REFUND_FAILED_RECOVERABLE' ? ['payer'] : ['recipient'];
    return { ...base, retry: { allowed: true, authorizedRoles: roles } };
  }

  return base;
}

/** Every state, for the demo status matrix and for visual regression baselines. */
export const MOCK_STATE_MATRIX: ReadonlyArray<ChainState> = CHAIN_STATES;

/** The LOCKED-after-cutoff variant, which the matrix above cannot express. */
export function mockDerivedReleaseEligible(role: Role): DerivedProjection {
  return {
    expired: false,
    cancelWindowOpen: false,
    releaseEligible: true,
    retry: null,
    callerRole: role,
  };
}
