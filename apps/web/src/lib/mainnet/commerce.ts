import { z } from 'zod';
import { bindMainnetCommerceTerms, MainnetCommerceSessionSchema, verifyMainnetCommerceBinding } from '@taply/near-client';
import type { MainnetCommerceSession } from '@taply/near-client';
import type { MainnetIntentTerms } from '@taply/shared';

/**
 * Per-sale commerce commitment (docs/MAINNET_PHASE4_PROTOCOL.md "Merchant /
 * Handshake requirements"), on Codex's bindMainnetCommerceTerms /
 * verifyMainnetCommerceBinding. One public session per sale; it holds no join
 * or bearer token. Its commitment is written into the immutable request memo and
 * determines the request id, so a session cannot mint a second request.
 *
 * The payer receives {session, termsHash} in the link FRAGMENT (`c=`), reviews
 * that hash, and the pay page compares it with the FINAL request read from the
 * pinned contract before offering any payment method. Presence, SSE and the
 * Handshake server never establish identity, funding or settlement.
 */
const HEX64 = /^[0-9a-f]{64}$/;
export const COMMERCE_PREFIX = 'taply-commerce-v1:';

export interface SaleCommitment { readonly session: MainnetCommerceSession; readonly termsHash: string }
const SaleSchema = z.strictObject({ v: z.literal(1), session: MainnetCommerceSessionSchema, termsHash: z.string().regex(HEX64) });

function randomHex32(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** A fresh session for one sale. Funding expiry of the bound request must not exceed `expiresAtNs`. */
export function newCommerceSession(contractId: string, merchantAccountId: string, expiresAtNs: string): MainnetCommerceSession {
  return MainnetCommerceSessionSchema.parse({ version: 'taply.commerce.v1', network: 'near-mainnet', contractId, merchantAccountId,
    sessionId: randomHex32(), sessionNonce: randomHex32(), expiresAtNs });
}

/** Bind a draft instant request to a sale session (Codex). Throws on memo overflow, wrong merchant or expiry. */
export function bindSale(draft: MainnetIntentTerms, session: MainnetCommerceSession): { terms: MainnetIntentTerms; sale: SaleCommitment } {
  const bound = bindMainnetCommerceTerms('instant', draft, session);
  return { terms: bound.terms as MainnetIntentTerms, sale: { session: bound.binding.session, termsHash: bound.termsHash } };
}

export function encodeSale(sale: SaleCommitment): string {
  const json = JSON.stringify(SaleSchema.parse({ v: 1, session: sale.session, termsHash: sale.termsHash }));
  return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `c=<payload>` from a fragment such as `#c=…` or `#j=<token>&c=…`. Strict; anything malformed → null. */
export function saleFromHash(hash: string): SaleCommitment | null {
  const m = /^#(?:j=[A-Za-z0-9_-]{22,64}&)?c=([A-Za-z0-9_-]{1,3000})$/.exec(hash);
  if (!m) return null;
  try {
    const b64 = m[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
    const parsed = SaleSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    return parsed.success ? { session: parsed.data.session, termsHash: parsed.data.termsHash } : null;
  } catch { return null; }
}

/** Compare the FINAL request terms with the reviewed sale (Codex verifier). */
export function saleMatches(terms: MainnetIntentTerms, sale: SaleCommitment): boolean {
  return verifyMainnetCommerceBinding('instant', terms, sale.session, sale.termsHash);
}

/** The memo the customer wrote, without the commitment line. */
export function displayMemo(memo: string): string {
  return memo.startsWith(COMMERCE_PREFIX) && memo[COMMERCE_PREFIX.length + 64] === '\n' ? memo.slice(COMMERCE_PREFIX.length + 65) : memo;
}

const SALE_KEY = 'taply.mainnet.sale.v1:';
/** Merchant device keeps the sale payload so a Live Handshake link can carry it. */
export function rememberSale(storage: Pick<Storage, 'setItem'>, requestId: string, sale: SaleCommitment): void {
  storage.setItem(SALE_KEY + requestId, encodeSale(sale));
}
export function recalledSale(storage: Pick<Storage, 'getItem'>, requestId: string): string | null {
  const v = storage.getItem(SALE_KEY + requestId);
  return v !== null && saleFromHash(`#c=${v}`) !== null ? v : null;
}
