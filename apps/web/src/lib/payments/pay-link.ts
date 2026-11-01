import { HashHexSchema } from '@/lib/protocol';
import { CHECKOUT_PATH, checkMerchantAccount } from '@/lib/merchant/discovery';

/**
 * Reads what a person pasted or a camera decoded: a Taply pay link
 * (`https://<approved origin>/pay/<id>`) or a bare 64-hex request ID.
 *
 * The content is untrusted (anyone can print a QR sticker). Only the request
 * ID is kept. The app never follows the scanned host, query or fragment: it
 * opens its own `/pay/<id>`, which reads the terms from the pinned contract at
 * a finalized block, so a code cannot smuggle in different terms, an amount,
 * a recipient or a wallet-return parameter.
 *
 * A pay link from an origin this app does not serve is reported as
 * `other_site` (with its host, so the person can see where it points) instead
 * of being opened.
 */

/** Longer than any real pay link; anything bigger is not one. */
export const MAX_PAY_INPUT_LENGTH = 2048;

export type PayInput =
  | { readonly kind: 'request'; readonly id: string }
  | { readonly kind: 'other_site'; readonly host: string }
  | { readonly kind: 'invalid' };

const PAY_PATH = /^\/pay\/([^/]+)\/?$/;
/** Control, zero-width, bidi-override and line/paragraph separator characters. */
function hasInvisible(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
    if ((c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) return true;
  }
  return false;
}

export function parsePayInput(input: string, approvedOrigins: ReadonlyArray<string>): PayInput {
  if (input.length > MAX_PAY_INPUT_LENGTH) return { kind: 'invalid' };
  const text = input.trim();
  if (text === '' || hasInvisible(text)) return { kind: 'invalid' };
  if (HashHexSchema.safeParse(text).success) return { kind: 'request', id: text };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'invalid' };
  if (url.username !== '' || url.password !== '') return { kind: 'invalid' };
  const id = PAY_PATH.exec(url.pathname)?.[1];
  if (id === undefined || !HashHexSchema.safeParse(id).success) return { kind: 'invalid' };
  if (!approvedOrigins.includes(url.origin)) return { kind: 'other_site', host: url.host };
  return { kind: 'request', id };
}

/**
 * Everything the scanner and the paste field accept: a pay request (as above)
 * or a merchant discovery link `https://<approved origin>/checkout/<accountId>`.
 *
 * A discovery link only ever opens this app's own read-only checkout page for
 * that account. Its query and fragment are dropped, so a sticker cannot
 * substitute a recipient, an amount or a wallet action. A bare account ID is
 * NOT accepted here: typed text is ambiguous, and a QR must say what it is.
 */
export type ScanInput =
  | PayInput
  | { readonly kind: 'merchant'; readonly accountId: string }
  | { readonly kind: 'invalid_merchant'; readonly reason: 'syntax' | 'not_testnet' };

export function parseScanInput(input: string, approvedOrigins: ReadonlyArray<string>): ScanInput {
  const pay = parsePayInput(input, approvedOrigins);
  if (pay.kind !== 'invalid') return pay;
  const text = input.trim();
  if (input.length > MAX_PAY_INPUT_LENGTH || text === '' || hasInvisible(text)) return pay;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return pay;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return pay;
  if (url.username !== '' || url.password !== '') return pay;
  const raw = CHECKOUT_PATH.exec(url.pathname)?.[1];
  if (raw === undefined) return pay;
  if (!approvedOrigins.includes(url.origin)) return { kind: 'other_site', host: url.host };
  const checked = checkMerchantAccount(raw);
  if (!checked.ok) return { kind: 'invalid_merchant', reason: checked.reason };
  return { kind: 'merchant', accountId: checked.accountId };
}
