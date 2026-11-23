'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createMainnetSwapReader, quoteMainnetSwap, type MainnetSwapRead, type MainnetSwapQuoteMath } from '@taply/near-client';
import { signingProfiles, USDC_CODE_HASH } from '@/lib/mainnet/wallet-ops';
import { isPoolSwap, type SwapAsset } from './model';

/**
 * Quote lifecycle: debounced, sequence-numbered (a slower old response can never
 * overwrite a newer one), expiring, with a BOUNDED automatic refresh. Nothing
 * here polls forever or signs.
 */
export const QUOTE_DEBOUNCE_MS = 400;
export const QUOTE_TTL_MS = 30_000;
export const QUOTE_AUTO_REFRESHES = 3;

export interface SwapQuote {
  readonly key: string;
  readonly read: Omit<MainnetSwapRead, never>;
  /** null for NEAR <-> wNEAR (1:1 wrap.near, no pool). */
  readonly math: MainnetSwapQuoteMath | null;
  readonly expectedOut: bigint | null;
  readonly fetchedAt: number;
}
export type QuoteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly key: string; readonly previous: SwapQuote | null }
  | { readonly kind: 'ready'; readonly quote: SwapQuote; readonly expired: boolean }
  | { readonly kind: 'error'; readonly key: string; readonly code: string };

export function quoteKey(from: SwapAsset, to: SwapAsset, amount: bigint | null, accountId: string | null): string {
  return `${from.id}|${to.id}|${amount ?? ''}|${accountId ?? ''}`;
}

export type QuoteFetcher = (from: SwapAsset, to: SwapAsset, amount: bigint | null, accountId: string | null) => Promise<Omit<SwapQuote, 'key' | 'fetchedAt'>>;

export const liveQuoteFetcher: QuoteFetcher = async (from, to, amount, accountId) => {
  const profiles = signingProfiles();
  if (profiles === null) throw new Error('NOT_MAINNET');
  if (!USDC_CODE_HASH) throw new Error('TOKEN_CODE_PIN_REQUIRED');
  const reader = createMainnetSwapReader(profiles.network, USDC_CODE_HASH);
  let full;
  try { full = await reader.read(accountId); }
  catch (e) {
    // A Taply Wallet that never received NEAR has no Mainnet account yet: quote without balances.
    if (accountId === null) throw e;
    full = await reader.read(null);
    if (amount === null) throw Object.assign(new Error('ACCOUNT_NOT_ACTIVATED'), { code: 'ACCOUNT_NOT_ACTIVATED' });
  }
  const { chain, ...read } = full;
  if (amount === null || from.id === to.id) return { read, math: null, expectedOut: null };
  if (!isPoolSwap(from, to)) return { read, math: null, expectedOut: amount };
  const math = await quoteMainnetSwap(chain, read.pool, from.token, to.token, amount.toString());
  return { read, math, expectedOut: BigInt(math.expectedOut) };
};

function errorCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code;
  return e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'QUOTE_UNAVAILABLE';
}

export function useSwapQuote(input: { from: SwapAsset; to: SwapAsset; amount: bigint | null; accountId: string | null; enabled: boolean; fetcher?: QuoteFetcher; now?: () => number }) {
  const { from, to, amount, accountId, enabled } = input;
  const fetcher = input.fetcher ?? liveQuoteFetcher;
  const now = input.now ?? Date.now;
  const [state, setState] = useState<QuoteState>({ kind: 'idle' });
  const seq = useRef(0);
  const autoRefreshes = useRef(0);
  const key = quoteKey(from, to, amount, accountId);

  const load = useCallback(async (k: string) => {
    const mine = ++seq.current;
    setState(prev => ({ kind: 'loading', key: k, previous: prev.kind === 'ready' && prev.quote.key === k ? prev.quote : null }));
    try {
      const q = await fetcher(from, to, amount, accountId);
      if (mine !== seq.current) return; // a newer request owns the screen
      setState({ kind: 'ready', quote: { ...q, key: k, fetchedAt: now() }, expired: false });
    } catch (e) {
      if (mine !== seq.current) return;
      setState({ kind: 'error', key: k, code: errorCode(e) });
    }
  }, [fetcher, from, to, amount, accountId, now]);

  // Debounced load on every input change; the old in-flight result is dropped by seq.
  useEffect(() => {
    if (!enabled) { seq.current++; queueMicrotask(() => setState({ kind: 'idle' })); return; }
    autoRefreshes.current = 0;
    seq.current++;
    const t = setTimeout(() => { void load(key); }, QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, enabled, load]);

  // Expiry, then at most QUOTE_AUTO_REFRESHES automatic refreshes while the tab is visible.
  useEffect(() => {
    if (state.kind !== 'ready' || state.expired) return;
    const left = state.quote.fetchedAt + QUOTE_TTL_MS - now();
    const t = setTimeout(() => {
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (visible && autoRefreshes.current < QUOTE_AUTO_REFRESHES && state.quote.key === key) { autoRefreshes.current++; void load(key); }
      else setState(s => s.kind === 'ready' ? { ...s, expired: true } : s);
    }, Math.max(0, left));
    return () => clearTimeout(t);
  }, [state, key, load, now]);

  const refresh = useCallback(() => { autoRefreshes.current = 0; void load(key); }, [load, key]);
  /** The quote for exactly the current inputs, or null (stale keys are never returned). */
  const current = state.kind === 'ready' && state.quote.key === key ? state.quote : state.kind === 'loading' && state.previous?.key === key ? state.previous : null;
  return { state, current, refresh, key, expired: state.kind === 'ready' && state.expired && state.quote.key === key };
}
