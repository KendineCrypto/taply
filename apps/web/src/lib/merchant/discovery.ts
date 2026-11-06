import { AccountIdSchema } from '@/lib/protocol';
import { validateShareOrigin } from '@/lib/share/origin';

/**
 * Merchant discovery links (`/checkout/<accountId>`, freeze section 5).
 *
 * A permanent merchant QR is DISCOVERY ONLY. It names a NEAR Testnet account
 * and opens this app's own checkout page. It is never a payable invoice: it
 * carries no amount, no request, no recipient override and no wallet action.
 * Every sale is a separate, uniquely signed request created by the merchant.
 *
 * Account syntax never proves the account exists, belongs to a business, or is
 * the merchant a person expects. The checkout page says so.
 */

export type MerchantAccountKind = 'named' | 'implicit' | 'eth_implicit';

export type MerchantAccountCheck =
  | { readonly ok: true; readonly accountId: string; readonly kind: MerchantAccountKind }
  | { readonly ok: false; readonly reason: 'syntax' | 'not_testnet' };

const IMPLICIT = /^[0-9a-f]{64}$/;
const ETH_IMPLICIT = /^0x[0-9a-f]{40}$/;

/**
 * Validates a merchant account for NEAR Testnet. Named accounts must end in
 * `.testnet`; implicit (64 hex) and ETH-implicit (`0x` + 40 hex) IDs are
 * network-neutral. Nothing is normalized: an uppercase or padded value is
 * rejected rather than silently changed into a different account.
 */
export function checkMerchantAccount(raw: string): MerchantAccountCheck {
  if (!AccountIdSchema.safeParse(raw).success) return { ok: false, reason: 'syntax' };
  if (IMPLICIT.test(raw)) return { ok: true, accountId: raw, kind: 'implicit' };
  if (ETH_IMPLICIT.test(raw)) return { ok: true, accountId: raw, kind: 'eth_implicit' };
  if (raw === 'testnet' || !raw.endsWith('.testnet')) return { ok: false, reason: 'not_testnet' };
  return { ok: true, accountId: raw, kind: 'named' };
}

/** The in-app route for a merchant's discovery page. Throws on an invalid account. */
export function merchantCheckoutPath(accountId: string): `/checkout/${string}` {
  const checked = checkMerchantAccount(accountId);
  if (!checked.ok) throw new Error('invalid merchant account');
  return `/checkout/${checked.accountId}`;
}

/** The one canonical discovery URL: QR, copy and share all use exactly this. */
export function canonicalCheckoutUrl(origin: string, accountId: string): string {
  const normalized = validateShareOrigin(origin);
  if (normalized === null) throw new Error('origin is not shareable');
  return `${normalized}${merchantCheckoutPath(accountId)}`;
}

/** Path matcher for a scanned or pasted discovery URL. No percent-encoding is accepted. */
export const CHECKOUT_PATH = /^\/checkout\/([^/]+)\/?$/;
