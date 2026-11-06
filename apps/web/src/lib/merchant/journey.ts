import { comparisonCode, HashHexSchema } from '@/lib/protocol';
import type { CallerRole } from '@/lib/protocol';

/**
 * Shared payment journey (Phase 7F): the presentation layer that makes the
 * merchant's and the customer's screens read as one payment.
 *
 * Everything here is presentation. It never decides a payment state: the
 * stage still comes from `progressStageFor` (contract state, local wallet
 * phase, independent verifier). The hints stored here only choose wording
 * ("Your sale", "Live checkout") and never unlock an action.
 */

/** Which side of the payment this device is on. */
export type JourneySide = 'receiver' | 'payer';

/** How this device reached the payment. Wording only. */
export type JourneyContext = 'pos' | 'checkout' | 'request';

export function journeySide(role: CallerRole): JourneySide {
  return role === 'recipient' || role === 'payer_and_recipient' ? 'receiver' : 'payer';
}

/**
 * A short code both phones derive from the request ID they read from the
 * chain. Same code = same request. It is NOT the Handshake comparison code
 * (that one is bound to a session commitment) and it proves nothing on its
 * own: the amount and the receiving account are still checked in full.
 */
export function saleCode(requestId: string): string | null {
  return HashHexSchema.safeParse(requestId).success ? comparisonCode(requestId) : null;
}

/** "4K7Q2M" -> "4K7 Q2M" for reading aloud across a counter. */
export function groupCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/* ------------------------------------------------------------------------ */
/* Live watch cadence for the receiving side while a request is open         */
/* ------------------------------------------------------------------------ */

/** Read-only re-read every 5 s for the first 10 minutes, then every 15 s. */
export const LIVE_WATCH_FAST_MS = 5_000;
export const LIVE_WATCH_SLOW_MS = 15_000;
export const LIVE_WATCH_FAST_WINDOW_MS = 10 * 60 * 1000;

export function liveWatchDelayMs(elapsedMs: number): number {
  return elapsedMs < LIVE_WATCH_FAST_WINDOW_MS ? LIVE_WATCH_FAST_MS : LIVE_WATCH_SLOW_MS;
}

/** The receiver of a request that is open and still payable at the observed final block. */
export function shouldLiveWatch(input: {
  readonly status: string;
  readonly callerRole: CallerRole;
  readonly observedAtNs: string;
  readonly fundingExpiresAtNs: string;
}): boolean {
  return (
    input.status === 'OPEN' &&
    journeySide(input.callerRole) === 'receiver' &&
    BigInt(input.observedAtNs) < BigInt(input.fundingExpiresAtNs)
  );
}

/* ------------------------------------------------------------------------ */
/* Context hints (wording only; never an authority)                          */
/* ------------------------------------------------------------------------ */

export interface HintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const POS_SALES_KEY = 'taply.posSales.v1';
export const CHECKOUT_HINT_KEY = 'taply.checkout.v1';
export const MAX_POS_SALES = 50;
/** A checkout visit frames a payment as "live checkout" for this long. */
export const CHECKOUT_HINT_MS = 30 * 60 * 1000;

function safeStorage(get: () => Storage): HintStorage | null {
  try {
    return get();
  } catch {
    return null;
  }
}

export const localHints = (): HintStorage | null => (typeof window === 'undefined' ? null : safeStorage(() => window.localStorage));
export const sessionHints = (): HintStorage | null => (typeof window === 'undefined' ? null : safeStorage(() => window.sessionStorage));

function readIds(storage: HintStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(POS_SALES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && HashHexSchema.safeParse(v).success) : [];
  } catch {
    return [];
  }
}

/** Remember that this device created `id` from the merchant POS. */
export function rememberPosSale(storage: HintStorage | null, id: string): void {
  if (storage === null || !HashHexSchema.safeParse(id).success) return;
  try {
    const ids = [id, ...readIds(storage).filter((v) => v !== id)].slice(0, MAX_POS_SALES);
    storage.setItem(POS_SALES_KEY, JSON.stringify(ids));
  } catch {
    // Storage full or blocked: the page just uses neutral wording.
  }
}

export function isPosSale(storage: HintStorage | null, id: string): boolean {
  return storage !== null && readIds(storage).includes(id);
}

/** Remember that the customer opened a sale from this account's checkout page. */
export function rememberCheckout(storage: HintStorage | null, accountId: string, nowMs: number): void {
  if (storage === null) return;
  try {
    storage.setItem(CHECKOUT_HINT_KEY, JSON.stringify({ accountId, at: nowMs }));
  } catch {
    // Ignored: wording only.
  }
}

/** True when the customer came from the checkout of exactly this receiving account, recently. */
export function cameFromCheckout(storage: HintStorage | null, recipientAccountId: string, nowMs: number): boolean {
  if (storage === null) return false;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CHECKOUT_HINT_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return false;
    const { accountId, at } = parsed as { accountId?: unknown; at?: unknown };
    return accountId === recipientAccountId && typeof at === 'number' && nowMs - at >= 0 && nowMs - at <= CHECKOUT_HINT_MS;
  } catch {
    return false;
  }
}

export function journeyContext(input: {
  readonly side: JourneySide;
  readonly posSale: boolean;
  readonly fromCheckout: boolean;
}): JourneyContext {
  if (input.side === 'receiver') return input.posSale ? 'pos' : 'request';
  return input.fromCheckout ? 'checkout' : 'request';
}

/* ------------------------------------------------------------------------ */
/* Phase 7G: one canonical status per side                                   */
/* ------------------------------------------------------------------------ */

/**
 * The short status both phones print above the headline. Derived ONLY from
 * the evidence-based progress stage (contract state at a finalized block, this
 * device's own open wallet window, the independent verifier) plus, on the
 * paying side, this device's own unexplained payment attempt in its journal.
 * Never from a scan, a timer or the other phone.
 */
export type JourneyStatus =
  // Receiving side (merchant)
  | 'ready_for_customer'
  | 'payment_observed'
  | 'verified_receipt'
  // Paying side (customer)
  | 'ready_to_review'
  | 'awaiting_wallet'
  | 'checking_chain'
  | 'transaction_submitted'
  | 'verified_paid'
  // Both
  | 'paid_per_contract'
  | 'needs_attention'
  | 'closed';

type StageLike = 'awaiting' | 'wallet' | 'transfer' | 'contract_paid' | 'verified' | 'failed' | 'unresolved' | 'cancelled';

export function journeyStatus(input: {
  readonly side: JourneySide;
  readonly stage: StageLike;
  /** Paying side only: this device's own payment attempt is not yet explained by the chain. */
  readonly ownAttemptPending?: boolean;
}): JourneyStatus {
  const { side, stage } = input;
  switch (stage) {
    case 'failed':
    case 'unresolved':
      return 'needs_attention';
    case 'cancelled':
      return 'closed';
    case 'contract_paid':
      return 'paid_per_contract';
    case 'verified':
      return side === 'receiver' ? 'verified_receipt' : 'verified_paid';
    case 'transfer':
      return side === 'receiver' ? 'payment_observed' : 'transaction_submitted';
    case 'wallet':
      return side === 'receiver' ? 'ready_for_customer' : 'awaiting_wallet';
    case 'awaiting':
      if (side === 'receiver') return 'ready_for_customer';
      return input.ownAttemptPending === true ? 'checking_chain' : 'ready_to_review';
  }
}

/** Only these two statuses may use the success (lime) treatment. */
export function isVerifiedStatus(status: JourneyStatus): boolean {
  return status === 'verified_receipt' || status === 'verified_paid';
}
