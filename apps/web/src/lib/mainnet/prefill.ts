import type { Route } from 'next';
import { formatBaseUnits } from '@/lib/format/amount';
import { MAINNET_ASSETS, parseMainnetAmount } from './assets';

/**
 * Prefilled request composer links (Split shares, Recurring drafts). Only
 * values the composer re-validates are passed: asset, an exact decimal amount
 * and a memo. Opening the link creates nothing; the merchant still reviews
 * and signs (signing is gated off while NO-GO).
 */
export function requestPrefill(asset: 'NEAR' | 'USDC', baseUnits: string, memo: string): Route {
  const amount = formatBaseUnits(baseUnits, MAINNET_ASSETS[asset].decimals, { maxFractionDigits: MAINNET_ASSETS[asset].decimals }).exact.replace(/,/g, '');
  const q = new URLSearchParams({ asset, amount, memo: memo.slice(0, 120) });
  return `/m/request/new?${q.toString()}` as Route;
}

export interface Prefill { readonly asset: 'NEAR' | 'USDC'; readonly amount: string; readonly memo: string }

/** Reads and re-validates a prefill. Invalid or over-cap values are dropped, never coerced. */
export function readPrefill(search: string): Prefill | null {
  const q = new URLSearchParams(search);
  const asset = q.get('asset');
  if (asset !== 'NEAR' && asset !== 'USDC') return null;
  const amount = q.get('amount') ?? '';
  const memo = (q.get('memo') ?? '').slice(0, 120);
  return { asset, amount: parseMainnetAmount(amount, MAINNET_ASSETS[asset]).ok ? amount : '', memo: new TextEncoder().encode(memo).length <= 256 ? memo : '' };
}
