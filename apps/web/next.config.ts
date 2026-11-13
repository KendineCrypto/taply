import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { evaluateMainnetEnv } from './scripts/check-mainnet-env.mjs';

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

/**
 * Mainnet isolation guard (docs/MAINNET_INFRA.md §4). A NEAR Testnet build
 * never enters this branch, so it behaves exactly as before. A mainnet
 * production build refuses to start if any Testnet value (for example from the
 * committed .env.production), the staging contract on Production, the
 * recovery account or the Testnet host survived; `pnpm build:mainnet` runs the
 * same checks with per-key sources before this point.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD && process.env.NEXT_PUBLIC_TAPLY_NETWORK === 'near-mainnet') {
    const { checks } = evaluateMainnetEnv({ env: process.env, vercelEnv: process.env['VERCEL_ENV'], requireMainnet: true });
    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      throw new Error(`Mainnet build refused:\n${failed.map((c) => `  - ${c.name}: ${c.detail ?? ''}`).join('\n')}`);
    }
  }
  return nextConfig;
}
