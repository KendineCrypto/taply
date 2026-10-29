import type {
  Assurance,
  ChainObservation,
  ChainState,
  DerivedProjection,
  Role,
} from '@/lib/protocol';
import { isVerifiedPaid } from '@/lib/protocol';

/**
 * THE single source of payment presentation.
 *
 * Freeze section 9:
 *   "Dedicated pure `mapChainState(state, verification, role, derived)` returns
 *    ALL status copy/icons/colors and authorized CTA presentation. Exhaustive
 *    mapping; no arbitrary `paid` booleans."
 *   "NEVER turn LOCKED, any _IN_FLIGHT, or unknown status green/verified. Only
 *    FINAL_PAID + verified_final may get a Verified Paid ribbon."
 *
 * Every invariant here is enforced by ./__tests__/map-chain-state.test.ts across
 * the full cross-product of states, roles and assurances.
 */

/** Semantic tones. `success` is reserved; see SUCCESS_TONE_RULE below. */
export type StatusTone = 'neutral' | 'caution' | 'success' | 'muted' | 'danger';

export type StatusIcon = 'clock' | 'lock' | 'spinner' | 'check-shield' | 'undo' | 'alert' | 'x';

/**
 * Where the money actually is. Kept separate from the label so copy review and
 * tests can assert on fund position rather than on prose.
 */
export type MoneyPosition =
  | 'none'
  | 'escrowed'
  | 'in_flight'
  | 'to_recipient'
  | 'returned_to_payer'
  | 'uncertain';

export type CtaKind =
  | 'review_and_pay'
  | 'share_request'
  | 'cancel_unfunded'
  | 'cancel_protected'
  | 'release_protected'
  | 'retry_same_branch'
  | 'view_receipt'
  | 'check_chain_status';

export interface Cta {
  readonly kind: CtaKind;
  /** `primary` uses the lime action treatment; never the verified treatment. */
  readonly emphasis: 'primary' | 'secondary';
}

export interface StatusPresentation {
  readonly state: ChainState;
  readonly tone: StatusTone;
  readonly icon: StatusIcon;
  readonly money: MoneyPosition;
  /**
   * The ONLY flag that may render the lime Verified Paid ribbon. True exclusively
   * for FINAL_PAID + verified_final from a non-mock source.
   */
  readonly verifiedRibbon: boolean;
  /** Dictionary path: t.status[state].label and .payer/.recipient/.announce. */
  readonly copyKey: ChainState;
  readonly audience: 'payer' | 'recipient';
  readonly ctas: ReadonlyArray<Cta>;
  /** True when assurance/staleness means the view needs a freshness warning. */
  readonly needsFreshnessWarning: boolean;
  /** True when sources disagree; actions must be blocked. */
  readonly blocked: boolean;
  /**
   * True when the derived projection claims an impossible combination - e.g.
   * both an open cancel window and an eligible release. Freeze section 4 makes
   * those mutually exclusive ("at the exact cutoff, cancellation loses and
   * release becomes eligible"), so the projection cannot be trusted to tell the
   * user which rights they still have. We fail closed and offer neither branch.
   */
  readonly projectionContradiction: boolean;
}

/**
 * A projection that asserts both branches is self-inconsistent. Trusting either
 * side could show someone a cancel button the chain will reject, or a release
 * button that races a refund.
 */
function hasProjectionContradiction(state: ChainState, derived: DerivedProjection): boolean {
  if (state !== 'LOCKED') return false;
  return derived.cancelWindowOpen === true && derived.releaseEligible === true;
}

/**
 * States in which no payment-initiating or branch-selecting action may ever be
 * offered, because an outgoing transfer may still settle.
 */
const IN_FLIGHT_STATES: ReadonlyArray<ChainState> = [
  'PAYOUT_IN_FLIGHT',
  'REFUND_IN_FLIGHT',
  'RELEASE_IN_FLIGHT',
];

const RECOVERABLE_FAILURE_STATES: ReadonlyArray<ChainState> = [
  'PAYOUT_FAILED_RECOVERABLE',
  'REFUND_FAILED_RECOVERABLE',
  'RELEASE_FAILED_RECOVERABLE',
];

export function isInFlight(state: ChainState): boolean {
  return IN_FLIGHT_STATES.includes(state);
}

export function isRecoverableFailure(state: ChainState): boolean {
  return RECOVERABLE_FAILURE_STATES.includes(state);
}

/** Assurance values that must never carry a confident presentation. */
function assuranceIsConfident(assurance: Assurance): boolean {
  return assurance === 'verified_final';
}

interface Base {
  readonly tone: StatusTone;
  readonly icon: StatusIcon;
  readonly money: MoneyPosition;
}

/**
 * Tone/icon/money per state, independent of role and assurance.
 *
 * SUCCESS_TONE_RULE: `success` appears for exactly one state, FINAL_PAID, and is
 * downgraded to `caution` below unless assurance is verified_final.
 */
const BASE_BY_STATE: Readonly<Record<ChainState, Base>> = {
  OPEN: { tone: 'neutral', icon: 'clock', money: 'none' },
  CANCELLED_UNFUNDED: { tone: 'muted', icon: 'x', money: 'none' },
  PAYOUT_IN_FLIGHT: { tone: 'caution', icon: 'spinner', money: 'in_flight' },
  PAYOUT_FAILED_RECOVERABLE: { tone: 'caution', icon: 'alert', money: 'uncertain' },
  LOCKED: { tone: 'caution', icon: 'lock', money: 'escrowed' },
  REFUND_IN_FLIGHT: { tone: 'caution', icon: 'spinner', money: 'in_flight' },
  REFUND_FAILED_RECOVERABLE: { tone: 'caution', icon: 'alert', money: 'uncertain' },
  RELEASE_IN_FLIGHT: { tone: 'caution', icon: 'spinner', money: 'in_flight' },
  RELEASE_FAILED_RECOVERABLE: { tone: 'caution', icon: 'alert', money: 'uncertain' },
  FINAL_PAID: { tone: 'success', icon: 'check-shield', money: 'to_recipient' },
  CANCELLED_REFUNDED: { tone: 'muted', icon: 'undo', money: 'returned_to_payer' },
};

/** Payer and recipient read the same chain state differently. */
function audienceFor(role: Role): 'payer' | 'recipient' {
  return role === 'recipient' ? 'recipient' : 'payer';
}

function retryAuthorized(derived: DerivedProjection, role: Role): boolean {
  const retry = derived.retry;
  if (!retry || !retry.allowed) return false;
  return retry.authorizedRoles.includes(role);
}

/**
 * CTA gating. Every branch is deny-by-default: an action appears only when the
 * derived projection explicitly permits it AND the role matches. The contract
 * re-checks authority regardless (freeze section 3).
 */
function ctasFor(
  state: ChainState,
  role: Role,
  derived: DerivedProjection,
  blocked: boolean,
): ReadonlyArray<Cta> {
  if (blocked) return [];

  // Nothing may be initiated while an outgoing transfer might still settle.
  if (isInFlight(state)) {
    return [{ kind: 'check_chain_status', emphasis: 'secondary' }];
  }

  if (isRecoverableFailure(state)) {
    const ctas: Cta[] = [{ kind: 'check_chain_status', emphasis: 'secondary' }];
    if (retryAuthorized(derived, role)) {
      // Same branch, same destination, fresh operation nonce (freeze section 4).
      ctas.unshift({ kind: 'retry_same_branch', emphasis: 'primary' });
    }
    return ctas;
  }

  switch (state) {
    case 'OPEN': {
      const ctas: Cta[] = [];
      if (derived.expired) {
        // No pay CTA on an expired request, for anyone.
        if (role === 'creator' || role === 'recipient') {
          ctas.push({ kind: 'cancel_unfunded', emphasis: 'secondary' });
        }
        return ctas;
      }
      if (role === 'payer' || role === 'observer') {
        ctas.push({ kind: 'review_and_pay', emphasis: 'primary' });
      }
      if (role === 'creator' || role === 'recipient') {
        ctas.push({ kind: 'share_request', emphasis: 'primary' });
        ctas.push({ kind: 'cancel_unfunded', emphasis: 'secondary' });
      }
      return ctas;
    }

    case 'LOCKED': {
      // Fail closed on a self-contradictory projection rather than guessing
      // which branch the chain will honour.
      if (hasProjectionContradiction(state, derived)) {
        return [{ kind: 'check_chain_status', emphasis: 'secondary' }];
      }
      const ctas: Cta[] = [];
      // Only the payer, and only while the chain still has the window open.
      if (role === 'payer' && derived.cancelWindowOpen === true) {
        ctas.push({ kind: 'cancel_protected', emphasis: 'secondary' });
      }
      // After the cutoff anyone may submit the release (freeze section 4).
      if (derived.releaseEligible === true) {
        ctas.push({ kind: 'release_protected', emphasis: 'primary' });
      }
      return ctas;
    }

    case 'FINAL_PAID':
    case 'CANCELLED_REFUNDED':
      return [{ kind: 'view_receipt', emphasis: 'secondary' }];

    case 'CANCELLED_UNFUNDED':
      return [];

    // Already handled above, but the switch stays exhaustive on purpose.
    case 'PAYOUT_IN_FLIGHT':
    case 'REFUND_IN_FLIGHT':
    case 'RELEASE_IN_FLIGHT':
    case 'PAYOUT_FAILED_RECOVERABLE':
    case 'REFUND_FAILED_RECOVERABLE':
    case 'RELEASE_FAILED_RECOVERABLE':
      return [{ kind: 'check_chain_status', emphasis: 'secondary' }];

    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ChainState: ${String(value)}`);
}

export interface MapInput {
  readonly state: ChainState;
  readonly observation: Pick<
    ChainObservation<unknown>,
    'assurance' | 'source' | 'stale' | 'rpcAvailable'
  >;
  readonly role: Role;
  readonly derived: DerivedProjection;
}

export function mapChainState({ state, observation, role, derived }: MapInput): StatusPresentation {
  const base = BASE_BY_STATE[state];
  const blocked = observation.assurance === 'mismatch';

  // A verified ribbon requires ALL of: the final paid state, verified_final
  // assurance, and a non-mock source. Mock data can never look verified.
  const verifiedRibbon =
    isVerifiedPaid(state, observation.assurance) && observation.source !== 'mock';

  // Downgrade: FINAL_PAID that is not yet verified_final is NOT a success.
  let tone: StatusTone = base.tone;
  if (tone === 'success' && !verifiedRibbon) tone = 'caution';
  if (blocked) tone = 'danger';

  let icon: StatusIcon = base.icon;
  if (base.icon === 'check-shield' && !verifiedRibbon) icon = 'spinner';
  if (blocked) icon = 'alert';

  // Money position degrades to uncertain when the claim is not confidently
  // observed, so copy and tests cannot assert settlement from a weak read.
  let money: MoneyPosition = base.money;
  if (observation.assurance === 'unknown' || blocked) {
    money = base.money === 'none' ? 'none' : 'uncertain';
  }
  if (state === 'FINAL_PAID' && !assuranceIsConfident(observation.assurance)) {
    money = 'uncertain';
  }
  // Mock data must never assert that funds reached anyone, even when the fixture
  // claims FINAL_PAID + verified_final. `verifiedRibbon` is already false for a
  // mock source; this keeps the money position consistent with that.
  if (observation.source === 'mock' && money === 'to_recipient') {
    money = 'uncertain';
  }

  const needsFreshnessWarning =
    observation.stale ||
    !observation.rpcAvailable ||
    observation.assurance === 'unverified' ||
    observation.assurance === 'pending_finality' ||
    observation.assurance === 'unknown';

  const projectionContradiction = hasProjectionContradiction(state, derived);

  return {
    state,
    tone,
    icon,
    money,
    verifiedRibbon,
    copyKey: state,
    audience: audienceFor(role),
    ctas: ctasFor(state, role, derived, blocked),
    needsFreshnessWarning: needsFreshnessWarning || projectionContradiction,
    blocked,
    projectionContradiction,
  };
}
