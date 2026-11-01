import { HashHexSchema } from '@/lib/protocol';

/**
 * Extracts a request ID from what a person pasted: a Taply pay link
 * (`https://<host>/pay/<id>`) or a bare 64-hex request ID.
 *
 * Only the ID is kept. The app never follows the pasted host: it opens its
 * own `/pay/<id>`, which reads the request from the approved contract at a
 * finalized block, so a link cannot smuggle in different terms.
 */
export function requestIdFromPayLink(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  if (HashHexSchema.safeParse(text).success) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const match = /^\/pay\/([^/]+)\/?$/.exec(url.pathname);
  const id = match?.[1];
  if (id === undefined) return null;
  return HashHexSchema.safeParse(id).success ? id : null;
}
