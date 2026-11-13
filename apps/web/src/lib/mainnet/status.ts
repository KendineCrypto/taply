import { MAINNET_INDEPENDENT_VERIFIER_AVAILABLE } from './release-gates';

/**
 * Customer/merchant payment state for a mainnet instant request
 * (docs/MAINNET.md "Events, configuration and finality", PAYMENT_STATE_MACHINE).
 *
 * Sources and their weight:
 *  - the contract's request status read at a FINAL block: the only source that
 *    can reach "Payment recorded";
 *  - the 1Click execution status: a HINT about the cross-chain leg only. It can
 *    move the screen between waiting states and explain refunds/failures, but
 *    SUCCESS never means the merchant was paid;
 *  - independent receipt verification: not implemented on mainnet, so
 *    "Verified" is unreachable (MAINNET_INDEPENDENT_VERIFIER_AVAILABLE=false).
 *
 * Nothing here retries, re-quotes or suggests paying again. R-2 (a payout
 * transfer whose callback never resolved) stays an explicit unknown.
 */

export type ContractStatus = 'OPEN' | 'CANCELLED_UNFUNDED' | 'PAYOUT_IN_FLIGHT' | 'PAYOUT_FAILED_RECOVERABLE' | 'FINAL_PAID';
export type OneClickStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

export const ONECLICK_STATUSES: ReadonlyArray<OneClickStatus> = [
  'PENDING_DEPOSIT',
  'KNOWN_DEPOSIT_TX',
  'INCOMPLETE_DEPOSIT',
  'PROCESSING',
  'SUCCESS',
  'REFUNDED',
  'FAILED',
];

export type PaymentState =
  | 'AWAITING_PAYMENT'
  | 'DEPOSIT_OBSERVED'
  | 'PROCESSING'
  | 'PAYMENT_RECORDED'
  | 'VERIFIED'
  | 'FAILED'
  | 'REFUNDED'
  | 'UNKNOWN';

/** Why a state was chosen; drives the explanatory copy. */
export type PaymentDetail =
  | 'none'
  | 'contract_unreadable'
  | 'request_missing'
  | 'oneclick_success_awaiting_contract'
  | 'payout_in_flight'
  | 'payout_in_flight_stale'
  | 'payout_failed_recoverable'
  | 'incomplete_deposit'
  | 'cancelled'
  | 'delivery_after_close'
  | 'success_not_settled'
  | 'hint_contradicts_contract'
  | 'contract_only';

export interface PaymentView {
  readonly state: PaymentState;
  readonly detail: PaymentDetail;
  /** True when the screen must tell the customer not to pay again. */
  readonly doNotRepay: boolean;
  /** Always false on mainnet today; kept explicit so a UI cannot assume otherwise. */
  readonly verifiedAvailable: boolean;
}

export interface PaymentInputs {
  /** Final-block contract read. `null` = request not found; `'error'` = could not read. */
  readonly contract: { readonly status: ContractStatus; readonly readAtMs: number; readonly inFlightSinceMs: number | null } | null | 'error';
  readonly oneClick: { readonly status: OneClickStatus; readonly sinceMs: number } | null;
  readonly nowMs: number;
}

/** After this long in PAYOUT_IN_FLIGHT the screen stops saying "processing" (R-2 policy). */
export const IN_FLIGHT_STALE_MS = 10 * 60_000;
/** After 1Click SUCCESS, how long an OPEN request is still "processing" before it needs investigation. */
export const SUCCESS_SETTLE_WINDOW_MS = 15 * 60_000;

const view = (state: PaymentState, detail: PaymentDetail, doNotRepay = false): PaymentView => ({
  state,
  detail,
  doNotRepay,
  verifiedAvailable: MAINNET_INDEPENDENT_VERIFIER_AVAILABLE,
});

export function derivePaymentView(input: PaymentInputs): PaymentView {
  const { contract, oneClick, nowMs } = input;
  const hint = oneClick?.status ?? null;
  const moneyMayBeMoving = hint !== null && hint !== 'PENDING_DEPOSIT';

  if (contract === 'error') {
    // Cannot see the contract: never guess. If the customer already sent funds,
    // say so and forbid a second payment.
    return view('UNKNOWN', 'contract_unreadable', moneyMayBeMoving);
  }
  if (contract === null) return view('UNKNOWN', 'request_missing', moneyMayBeMoving);

  switch (contract.status) {
    case 'FINAL_PAID':
      // Contract state is authoritative for "recorded". Verified stays off.
      return view('PAYMENT_RECORDED', hint === 'REFUNDED' || hint === 'FAILED' ? 'hint_contradicts_contract' : 'contract_only', true);
    case 'PAYOUT_IN_FLIGHT': {
      const since = contract.inFlightSinceMs ?? contract.readAtMs;
      return nowMs - since > IN_FLIGHT_STALE_MS
        ? view('UNKNOWN', 'payout_in_flight_stale', true)
        : view('PROCESSING', 'payout_in_flight', true);
    }
    case 'PAYOUT_FAILED_RECOVERABLE':
      // The contract holds the funds; only the merchant's explicit retry pays out.
      return view('FAILED', 'payout_failed_recoverable', true);
    case 'CANCELLED_UNFUNDED':
      return moneyMayBeMoving ? view('UNKNOWN', 'delivery_after_close', true) : view('FAILED', 'cancelled');
    case 'OPEN':
      break;
  }

  // Contract OPEN: only the cross-chain hint can explain progress.
  switch (hint) {
    case null:
    case 'PENDING_DEPOSIT':
      return view('AWAITING_PAYMENT', 'none');
    case 'KNOWN_DEPOSIT_TX':
      return view('DEPOSIT_OBSERVED', 'none', true);
    case 'PROCESSING':
      return view('PROCESSING', 'none', true);
    case 'SUCCESS':
      // 1Click delivered to the contract, but the contract has not recorded a
      // payout. Wait a bounded time, then say it needs investigation (the
      // delivery may sit in the unclaimed bucket). Never "paid".
      return nowMs - (oneClick?.sinceMs ?? nowMs) > SUCCESS_SETTLE_WINDOW_MS
        ? view('UNKNOWN', 'success_not_settled', true)
        : view('PROCESSING', 'oneclick_success_awaiting_contract', true);
    case 'REFUNDED':
      return view('REFUNDED', 'none');
    case 'INCOMPLETE_DEPOSIT':
      return view('FAILED', 'incomplete_deposit', true);
    case 'FAILED':
      return view('FAILED', 'none', true);
  }
}
