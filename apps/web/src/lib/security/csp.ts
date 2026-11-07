/**
 * Content-Security-Policy for Taply (Monday sprint, Phase D).
 *
 * Scripts are the point: only scripts carrying this response's random nonce,
 * and scripts those load ('strict-dynamic'), may run. That covers Next.js and
 * the wallet selector. `@hot-labs/near-connect` runs each wallet's code as
 * inline scripts in a sandboxed `srcdoc` iframe, which INHERITS this policy;
 * the connector is given the nonce (lib/wallet/near-connect.ts) so those run.
 *
 * Why some directives are wide, on purpose and documented:
 *  - connect-src https: wss: — the same inherited policy governs each wallet's
 *    own backend calls (HOT, MyNearWallet, Meteor, ...), which Taply cannot
 *    enumerate. HTTP and other schemes stay blocked. Taply's own RPC reads go
 *    only to the configured Testnet RPCs (validated HTTPS, genesis-checked).
 *  - img-src https: — wallet icons come from each wallet's manifest.
 *  - frame-src https: — wallet pages a wallet executor may open in a frame.
 *  - style-src 'unsafe-inline' https: and font-src https: — React style
 *    attributes, the selector's injected styles, and wallet UIs' own web
 *    fonts (Meteor loads rsms.me and cdnfonts stylesheets inside its
 *    executor frame; verified 2026-11-08). Stylesheets cannot run script.
 *
 * Not set: upgrade-insecure-requests (it would break http://127.0.0.1 testing;
 * production is HTTPS-only and should send HSTS instead).
 */

export type CspMode = 'enforce' | 'report-only' | 'off';

export function parseCspMode(value: string | undefined): CspMode {
  if (value === 'off' || value === 'report-only') return value;
  return 'enforce';
}

export function buildContentSecurityPolicy(input: { readonly nonce: string; readonly dev: boolean }): string {
  if (!/^[A-Za-z0-9+/=_-]{16,128}$/.test(input.nonce)) throw new Error('csp: invalid nonce');
  const directives: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ['default-src', ["'self'"]],
    // 'unsafe-eval' only in `next dev` (React debugging). Never in a production build.
    ['script-src', ["'self'", `'nonce-${input.nonce}'`, "'strict-dynamic'", ...(input.dev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", "'unsafe-inline'", 'https:']],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['font-src', ["'self'", 'data:', 'https:']],
    ['connect-src', ["'self'", 'https:', 'wss:', ...(input.dev ? ['ws:'] : [])]],
    ['frame-src', ["'self'", 'https:']],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['media-src', ["'self'", 'blob:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** 128 random bits, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * HSTS is only sent when TAPLY_HSTS_MAX_AGE is set (seconds, 0-63072000), and
 * never with includeSubDomains or preload: those affect every subdomain of
 * the domain and are hard to undo, so they are a deliberate later decision.
 */
export function hstsHeaderValue(maxAge: string | undefined): string | null {
  if (maxAge === undefined || !/^\d{1,8}$/.test(maxAge)) return null;
  const seconds = Number.parseInt(maxAge, 10);
  if (seconds > 63_072_000) return null;
  return `max-age=${seconds}`;
}
