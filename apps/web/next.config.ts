import type { NextConfig } from 'next';

/**
 * Taply v0.4 frontend config.
 *
 * Protocol Freeze v1 §8: payment/account/merchant/session JSON responses use
 * `Cache-Control: no-store`; a service worker may cache the static shell and
 * assets ONLY. No service worker is registered in Phase 0 — see
 * `src/lib/protocol/README.md` ("Deferred with reasons").
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Handshake join tokens must never leak via Referer or embedded contexts.
          // `same-origin-allow-popups`, not `same-origin`: NEAR Connect wallets
          // (e.g. MyNearWallet) open a popup that answers via window.opener.
          // Plain `same-origin` severs that link and breaks wallet sign-in.
          // Documents that open Taply still cannot keep a handle to it.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
