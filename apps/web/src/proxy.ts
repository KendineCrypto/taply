import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { buildContentSecurityPolicy, createNonce, hstsHeaderValue, parseCspMode } from '@/lib/security/csp';

/**
 * Per-request CSP nonce (Next.js 16 Proxy). Every page is dynamically rendered
 * (the root layout reads cookies/headers), so Next applies the nonce from the
 * request's CSP header to its own scripts. Static assets skip this.
 *
 * Server-only switches (not NEXT_PUBLIC, never shipped to the browser):
 *  - TAPLY_CSP_MODE=enforce (default) | report-only | off — a kill switch if a
 *    wallet breaks in the field.
 *  - TAPLY_HSTS_MAX_AGE=<seconds> — HSTS only on the final HTTPS host.
 */
export function proxy(request: NextRequest) {
  const mode = parseCspMode(process.env['TAPLY_CSP_MODE']);
  const hsts = hstsHeaderValue(process.env['TAPLY_HSTS_MAX_AGE']);
  if (mode === 'off') {
    const response = NextResponse.next();
    if (hsts !== null) response.headers.set('Strict-Transport-Security', hsts);
    return response;
  }
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === 'development' });
  const header = mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next reads the nonce from this request header (enforce or report-only alike).
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  if (hsts !== null) response.headers.set('Strict-Transport-Security', hsts);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon|icons/|brand/|evidence/|manifest.webmanifest|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
