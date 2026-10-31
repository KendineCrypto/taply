import { isVerifiedPaid, retryRoleMatchesKind } from '@/lib/protocol';
import type {
  Assurance,
  CallerRole,
  ChainObservation,
  ChainState,
  DerivedPaymentActions,
  ObservationSource,
  PaymentIntentResponse,
} from '@/lib/protocol';

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
 * Phase 0.5: every input type now comes from `@taply/shared`. `callerRole` lives
 * inside `derived` (as it does on the wire), and funding expiry arrives as
 * `fundingEligibility` rather than a local boolean - there is no second
 * definition of either.
 *
 * `@taply/shared`'s `PaymentIntentResponseSchema` already refuses to let an
 * uncertain, stale or mock observation enable a financial action. This module
 * restates that rule rather than relying on it, so an object that reached the UI
 * without validation still cannot produce a live control.
 */

/** Semantic tones. `success` is reserved; see SUCCESS_TONE_RULE below. */
export type StatusTone = 'neutral' | 'caution' | 'success' | 'muted' | 'danger';

export type StatusIcon = 'clock' | 'lock' | 'spinner' | 'check-shield' | 'check' | 'undo' | 'alert' | 'x';

/**
 * What proves the settlement, independently of the contract's own state.
 *
 * `contract_state_only`: a finalized read of the approved contract says
 *   FINAL_PAID. Strong evidence, but API.md is explicit: "The frontend can show
 *   Verified Paid only for FINAL_PAID with verified settlement proof", and
 *   `get_receipt` facts are CONTRACT_FACTS_NOT_FINALITY_PROOF.
 * `verified_receipt`: a VerifiedReceipt built by an RPC verifier that inspected
 *   the funding, transfer and callback receipts. Nothing in apps/web produces
 *   one yet, so the Verified Paid ribbon is currently unreachable in live use.
 */
export type SettlementProof = 'contract_state_only' | 'verified_receipt';

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
  | 'retry_same_operation'
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
  /**
   * FINAL_PAID from a confident, non-mock read, but without a verified receipt.
   * Renders "Paid per contract - settlement proof pending": never the ribbon,
   * never the success tone.
   */
  readonly contractReportsPaid: boolean;
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
  /**
   * True when the API reported an unresolved incident (callback failure, unknown
   * outcome, reconciliation required). Every financial action is withheld.
   */
  readonly incidentOpen: boolean;
}

type FundingEligibility = PaymentIntentResponse['fundingEligibility'];
type Incident = PaymentIntentResponse['incident'];

type ObservationFacts = Pick<
  ChainObservation<unknown>,
  'assurance' | 'source' | 'stale' | 'rpcAvailable'
>;

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

function assuranceIsConfident(assurance: Assurance): boolean {
  return assurance === 'verified_final';
}

/**
 * Mirrors the `fresh` predicate inside `PaymentIntentResponseSchema`: a
 * financial control may only appear when the state was verified final, is not
 * stale, live RPC is available, and no incident is open.
 */
function observationIsActionable(observation: ObservationFacts, incident: Incident): boolean {
  return (
    observation.assurance === 'verified_final' &&
    !observation.stale &&
    observation.rpcAvailable &&
    observation.source !== 'mock' &&
    incident === null
  );
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
 * downgraded to `caution` below unless the observation earns a verified ribbon.
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

/**
 * Payer and recipient read the same chain state differently.
 *
 * `payer_and_recipient` resolves to the recipient reading deliberately: the
 * "LOCKED - NOT PAID" warning is the safety-critical half of that pair.
 * `anonymous` and `observer` get the neutral payer-side wording.
 */
function audienceFor(role: CallerRole): 'payer' | 'recipient' {
  return role === 'recipient' || role === 'payer_and_recipient' ? 'recipient' : 'payer';
}

/** Roles that may hold cancellation rights on a funded protected request. */
function isPayerSide(role: CallerRole): boolean {
  return role === 'payer' || role === 'payer_and_recipient';
}

/** Roles that may become the payer of a request that is still open. */
function couldFund(role: CallerRole): boolean {
  return role === 'anonymous' || role === 'observer' || role === 'payer';
}

/** Roles that own the request, i.e. the creator/recipient. */
function isRequestOwner(role: CallerRole): boolean {
  return role === 'recipient' || role === 'payer_and_recipient';
}

function hasProjectionContradiction(state: ChainState, derived: DerivedPaymentActions): boolean {
  if (state !== 'LOCKED') return false;
  return derived.cancelWindowOpen === true && derived.releaseEligible === true;
}

function retryPermitted(derived: DerivedPaymentActions): boolean {
  const { retry, callerRole } = derived;
  if (!retry.eligible || retry.kind === null) return false;
  return retryRoleMatchesKind(callerRole, retry.kind);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ChainState: ${String(value)}`);
}

/**
 * CTA gating. Every branch is deny-by-default: an action appears only when the
 * observation is actionable AND the derived projection explicitly permits it AND
 * the role matches. The contract re-checks authority regardless (freeze
 * section 3: "UI flags do not grant authority").
 */
function ctasFor(
  state: ChainState,
  derived: DerivedPaymentActions,
  fundingEligibility: FundingEligibility,
  actionable: boolean,
  blocked: boolean,
): ReadonlyArray<Cta> {
  if (blocked) return [];

  const role = derived.callerRole;
  const checkOnly: ReadonlyArray<Cta> = [{ kind: 'check_chain_status', emphasis: 'secondary' }];

  // Nothing may be initiated while an outgoing transfer might still settle.
  if (isInFlight(state)) return checkOnly;

  // Terminal states are safe to read even from a stale or offline observation:
  // a final receipt stays historically verified (freeze section 3).
  if (state === 'FINAL_PAID' || state === 'CANCELLED_REFUNDED') {
    return [{ kind: 'view_receipt', emphasis: 'secondary' }];
  }

  if (state === 'CANCELLED_UNFUNDED') return [];

  // Beyond this point every action moves money, so the observation must be
  // actionable - verified final, fresh, live, non-mock, no open incident.
  if (!actionable) return checkOnly;

  switch (state) {
    case 'PAYOUT_FAILED_RECOVERABLE':
    case 'REFUND_FAILED_RECOVERABLE':
    case 'RELEASE_FAILED_RECOVERABLE': {
      const ctas: Cta[] = [...checkOnly];
      if (retryPermitted(derived)) {
        // Same branch, same destination, matching recorded failure and a fresh
        // operation nonce (freeze section 4).
        ctas.unshift({ kind: 'retry_same_operation', emphasis: 'primary' });
      }
      return ctas;
    }

    case 'OPEN': {
      const ctas: Cta[] = [];
      const fundable = fundingEligibility === 'ELIGIBLE';

      if (fundable && couldFund(role)) {
        ctas.push({ kind: 'review_and_pay', emphasis: 'primary' });
      }
      if (isRequestOwner(role)) {
        if (fundable) ctas.push({ kind: 'share_request', emphasis: 'primary' });
        ctas.push({ kind: 'cancel_unfunded', emphasis: 'secondary' });
      }
      return ctas;
    }

    case 'LOCKED': {
      // Fail closed on a self-contradictory projection rather than guessing
      // which branch the chain will honour.
      if (hasProjectionContradiction(state, derived)) return checkOnly;

      const ctas: Cta[] = [];
      // Only the payer side, and only while the chain still has the window open.
      if (isPayerSide(role) && derived.cancelWindowOpen === true) {
        ctas.push({ kind: 'cancel_protected', emphasis: 'secondary' });
      }
      // After the cutoff anyone may submit the release (freeze section 4).
      if (derived.releaseEligible === true) {
        ctas.push({ kind: 'release_protected', emphasis: 'primary' });
      }
      return ctas;
    }

    case 'PAYOUT_IN_FLIGHT':
    case 'REFUND_IN_FLIGHT':
    case 'RELEASE_IN_FLIGHT':
      // Returned earlier via isInFlight; retained so the switch stays exhaustive
      // over every state still reachable here.
      return checkOnly;

    default:
      return assertNever(state);
  }
}

export interface MapInput {
  readonly state: ChainState;
  readonly observation: ObservationFacts;
  /** Carries `callerRole`; there is no separate role parameter any more. */
  readonly derived: DerivedPaymentActions;
  readonly fundingEligibility: FundingEligibility;
  readonly incident: Incident;
  /** Required on purpose: every call site must say what proves settlement. */
  readonly settlementProof: SettlementProof;
}

export function mapChainState({
  state,
  observation,
  derived,
  fundingEligibility,
  incident,
  settlementProof,
}: MapInput): StatusPresentation {
  const base = BASE_BY_STATE[state];
  const blocked = observation.assurance === 'mismatch';
  const incidentOpen = incident !== null;
  const actionable = observationIsActionable(observation, incident);

  const confidentlyPaid = isVerifiedPaid(
    state,
    observation.assurance,
    observation.source as ObservationSource,
  );
  const verifiedRibbon = confidentlyPaid && settlementProof === 'verified_receipt' && !blocked;
  const contractReportsPaid = confidentlyPaid && !verifiedRibbon && !blocked;

  // Downgrade: FINAL_PAID that is not verified_final is NOT a success.
  let tone: StatusTone = base.tone;
  if (tone === 'success' && !verifiedRibbon) tone = contractReportsPaid ? 'neutral' : 'caution';
  if (blocked) tone = 'danger';

  let icon: StatusIcon = base.icon;
  if (base.icon === 'check-shield' && !verifiedRibbon) icon = contractReportsPaid ? 'check' : 'spinner';
  if (blocked) icon = 'alert';

  // Money position degrades to uncertain when the claim is not confidently
  // observed, so copy and tests cannot assert settlement from a weak read.
  let money: MoneyPosition = base.money;
  if (observation.assurance === 'unknown' || blocked || incidentOpen) {
    money = base.money === 'none' ? 'none' : 'uncertain';
  }
  if (state === 'FINAL_PAID' && !assuranceIsConfident(observation.assurance)) {
    money = 'uncertain';
  }
  // Mock data must never assert that funds reached anyone.
  if (observation.source === 'mock' && money === 'to_recipient') {
    money = 'uncertain';
  }

  const projectionContradiction = hasProjectionContradiction(state, derived);

  const needsFreshnessWarning =
    observation.stale ||
    !observation.rpcAvailable ||
    observation.assurance === 'unverified' ||
    observation.assurance === 'pending_finality' ||
    observation.assurance === 'unknown' ||
    projectionContradiction ||
    incidentOpen;

  return {
    state,
    tone,
    icon,
    money,
    verifiedRibbon,
    contractReportsPaid,
    copyKey: state,
    audience: audienceFor(derived.callerRole),
    ctas: ctasFor(state, derived, fundingEligibility, actionable, blocked),
    needsFreshnessWarning,
    blocked,
    projectionContradiction,
    incidentOpen,
  };
}
