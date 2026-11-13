import type { GiftView } from '@taply/near-client';

/**
 * What an Open Gift screen may say. Derived ONLY from a final, code-hash-pinned
 * chain read plus what THIS device's wallet reported. A wallet hash, a timer or
 * the envelope animation never makes anything "claimed".
 *
 * Required claim states (product spec): available, connecting, awaiting wallet,
 * claim submitted, claim pending on chain, claimed successfully, already
 * claimed, expired, refunded, verification unavailable.
 */
export type GiftUi =
  | { readonly kind: 'loading' }
  /** RPC down, code hash mismatch or malformed data. Never treated as anything else. */
  | { readonly kind: 'unavailable' }
  /** No such gift at the final block (wrong link, or funding not final yet). */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'available'; readonly gift: GiftView }
  | { readonly kind: 'connecting'; readonly gift: GiftView }
  | { readonly kind: 'awaiting_wallet'; readonly gift: GiftView }
  /** The wallet returned (or might have sent); the chain does not show a claim yet. */
  | { readonly kind: 'submitted'; readonly gift: GiftView; readonly txHash: string | null }
  /** The chain recorded MY winning claim; the payout result is not recorded yet. */
  | { readonly kind: 'claim_pending'; readonly gift: GiftView }
  /** The chain recorded MY claim AND the callback confirmed the transfer to me. */
  | { readonly kind: 'claimed'; readonly gift: GiftView }
  /** My claim won but the chain recorded that the transfer failed (funds came back; I can retry). */
  | { readonly kind: 'payout_failed'; readonly gift: GiftView }
  /** Someone else's claim was accepted first. */
  | { readonly kind: 'already_claimed'; readonly gift: GiftView }
  | { readonly kind: 'expired'; readonly gift: GiftView }
  | { readonly kind: 'refund_pending'; readonly gift: GiftView }
  | { readonly kind: 'refunded'; readonly gift: GiftView };

export type LocalClaim = 'idle' | 'connecting' | 'awaiting_wallet' | { readonly submitted: string | null };

export function deriveGiftUi(input: {
  readonly read: { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ok'; readonly gift: GiftView | null };
  readonly me: string | null;
  readonly local: LocalClaim;
}): GiftUi {
  const { read, me, local } = input;
  if (read.status === 'loading') return { kind: 'loading' };
  if (read.status === 'error') return { kind: 'unavailable' };
  const gift = read.gift;
  if (gift === null) return { kind: 'not_found' };
  switch (gift.status) {
    case 'AVAILABLE':
      if (local === 'connecting') return { kind: 'connecting', gift };
      if (local === 'awaiting_wallet') return { kind: 'awaiting_wallet', gift };
      if (typeof local === 'object') return { kind: 'submitted', gift, txHash: local.submitted };
      return { kind: 'available', gift };
    case 'EXPIRED':
      return { kind: 'expired', gift };
    case 'REFUNDED':
      return gift.payout === 'CONFIRMED' ? { kind: 'refunded', gift } : { kind: 'refund_pending', gift };
    case 'CLAIMED':
      if (me === null || gift.beneficiary !== me) return { kind: 'already_claimed', gift };
      if (gift.payout === 'CONFIRMED') return { kind: 'claimed', gift };
      if (gift.payout === 'FAILED') return { kind: 'payout_failed', gift };
      return { kind: 'claim_pending', gift };
  }
}

/** The gift may be claimed by `me` right now (UI hint; the contract decides). */
export function canClaim(ui: GiftUi, me: string | null): boolean {
  return ui.kind === 'available' && me !== null && ui.gift.creator !== me;
}

/** Remaining time until expiry, from chain time. Display only. */
export function remainingMs(expiresAtNs: string, chainNowNs: string): number {
  const left = (BigInt(expiresAtNs) - BigInt(chainNowNs)) / 1_000_000n;
  if (left <= 0n) return 0;
  // A duration, bounded by the contract's 30-day maximum (exactly representable), not an amount.
  const capped = left > 2_678_400_000n ? 2_678_400_000n : left;
  // eslint-disable-next-line no-restricted-syntax -- bounded display duration (<= 31 days of ms), never an amount
  return Number(capped);
}
