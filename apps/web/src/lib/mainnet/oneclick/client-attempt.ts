'use client';

import { useEffect, useState } from 'react';
import type { OriginChain, RefundFormat } from './allowlist';

/**
 * Browser side of a 1Click attempt.
 *
 * The attempt secret is 32 random bytes generated here and kept in this
 * origin's localStorage (shared by tabs, survives refresh) under a per-request
 * key. The server stores only its SHA-256, and shows the deposit address only
 * to a caller presenting it. It is not a wallet key and moves no money; losing
 * it only means this browser can no longer re-open the deposit instructions
 * (the requester and the payer still see progress and the receipt from chain).
 */
const KEY = (requestId: string) => `taply.mainnet.1click.attempt:${requestId}`;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function storedAttemptSecret(requestId: string): string | null {
  try {
    const v = localStorage.getItem(KEY(requestId));
    return v !== null && SECRET.test(v) ? v : null;
  } catch { return null; }
}

export function attemptSecretFor(requestId: string): string {
  const existing = storedAttemptSecret(requestId);
  if (existing !== null) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try { localStorage.setItem(KEY(requestId), secret); } catch { /* still usable for this page view */ }
  return secret;
}

export interface PublicOrigin {
  readonly assetId: string;
  readonly chain: OriginChain;
  readonly symbol: 'USDC' | 'USDT' | 'NEAR';
  readonly decimals?: number;
  readonly contractAddress: string;
  readonly refundAddressFormat: RefundFormat;
  readonly source: 'recorded-live-quote' | 'live-token-list' | 'fixture';
}

export interface OneClickAvailability {
  readonly origins: ReadonlyArray<PublicOrigin>;
  /** True only when this deployment serves approved funded quotes (real deposit addresses). */
  readonly funding: boolean;
}

let cached: Promise<OneClickAvailability | null> | null = null;
/** One request per page load. null = cross-chain payment is off (or the service is down). */
export function useOneClickAvailability(enabled = true): OneClickAvailability | null | undefined {
  const [value, setValue] = useState<OneClickAvailability | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    cached ??= fetch('/api/mainnet/oneclick/origins', { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) return null;
        const b = (await r.json()) as { origins?: unknown; funding?: unknown };
        return Array.isArray(b.origins) ? { origins: b.origins as PublicOrigin[], funding: b.funding === true } : null;
      })
      .catch(() => null);
    const pending = cached;
    void pending.then(v => { if (live) setValue(v); if (v === null && cached === pending) cached = null; });
    return () => { live = false; };
  }, [enabled]);
  return enabled ? value : null;
}
export function resetAvailabilityCacheForTests() { cached = null; }
