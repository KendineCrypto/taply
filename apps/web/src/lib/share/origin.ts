import { HashHexSchema } from '@/lib/protocol';

/**
 * Which origin share links and QR codes use (Phase 6A).
 *
 * A payment QR has to open on someone else's phone. A link built from
 * `localhost`, a LAN/Tailscale IP or plain HTTP looks fine on the computer that
 * made it and fails on the phone that scans it. So a link is only offered as
 * shareable when its origin is:
 *   - HTTPS,
 *   - a public-looking DNS name with at least one dot (no IP literals, no
 *     localhost / .local / .internal / other private-use names),
 *   - an origin only (no path, query, fragment or credentials).
 *
 * Choice, in order:
 *   1. NEXT_PUBLIC_TAPLY_SHARE_ORIGIN, if set and valid (an operator decision,
 *      for example a local pilot served through an HTTPS tunnel);
 *   2. the page's own origin, if it is valid (production);
 *   3. otherwise none: the screen says so instead of showing a QR that cannot work.
 *
 * The origin only builds links. The app never navigates to it, and its own link
 * parser accepts only the request ID (see lib/payments/pay-link.ts), so a share
 * origin cannot become an open redirect.
 */

const PRIVATE_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'home.arpa',
  'test',
  'invalid',
  'example',
] as const;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** The normalized origin (`https://host[:port]`) when `value` is a mobile-ready share origin, else null. */
export function validateShareOrigin(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (text === '' || text.length > 253 + 16) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') return null;
  // Reject a trailing '?' or '#' the URL parser normalizes away.
  if (/[?#]/.test(text)) return null;
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || host.includes(':') || IPV4.test(host)) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  // The top-level label of a public name is never all digits.
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return null;
  if (PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return null;
  return url.origin;
}

export type ShareOrigin =
  | { readonly kind: 'ok'; readonly origin: string; readonly source: 'configured' | 'current' }
  | {
      readonly kind: 'unavailable';
      /** `invalid_config`: the operator set a share origin that is not acceptable. */
      readonly reason: 'local_only' | 'invalid_config';
    };

export function resolveShareOrigin(input: {
  readonly configured: string | null | undefined;
  readonly current: string | null;
}): ShareOrigin {
  const configuredSet = input.configured !== undefined && input.configured !== null && input.configured.trim() !== '';
  const configured = validateShareOrigin(input.configured);
  if (configured !== null) return { kind: 'ok', origin: configured, source: 'configured' };
  const current = validateShareOrigin(input.current);
  if (current !== null) return { kind: 'ok', origin: current, source: 'current' };
  return { kind: 'unavailable', reason: configuredSet ? 'invalid_config' : 'local_only' };
}

/** The configured share origin from the build environment (raw, unvalidated). */
export function configuredShareOrigin(): string | undefined {
  return process.env.NEXT_PUBLIC_TAPLY_SHARE_ORIGIN;
}

/** The one canonical pay URL for a request: QR, copy and native share all use exactly this. */
export function canonicalPayUrl(origin: string, requestId: string): string {
  if (!HashHexSchema.safeParse(requestId).success) throw new Error('invalid request id');
  const normalized = validateShareOrigin(origin);
  if (normalized === null) throw new Error('origin is not shareable');
  return `${normalized}/pay/${requestId}`;
}

/**
 * Origins whose pay links this app opens when scanned or pasted: its own origin
 * and the configured share origin. Anything else is reported, not followed.
 */
export function approvedPayOrigins(current: string | null): string[] {
  const out = new Set<string>();
  if (current !== null) {
    try {
      out.add(new URL(current).origin);
    } catch {
      // ignore
    }
  }
  const configured = validateShareOrigin(configuredShareOrigin());
  if (configured !== null) out.add(configured);
  return [...out];
}
