import { HashHexSchema } from '@/lib/protocol';

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
