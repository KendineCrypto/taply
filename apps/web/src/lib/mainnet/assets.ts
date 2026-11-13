import { MAINNET_NATIVE_CAP, MAINNET_USDC, MAINNET_USDC_ASSET, MAINNET_USDC_CAP } from '@taply/shared';
import { InvalidAmountError, formatBaseUnits, toBaseUnits } from '@/lib/format/amount';
import type { Locale } from '@/lib/i18n/types';

export type MainnetAssetId = 'near:native' | typeof MAINNET_USDC_ASSET;

export interface MainnetAsset {
  readonly id: MainnetAssetId;
  readonly symbol: 'NEAR' | 'USDC';
  readonly decimals: 24 | 6;
  /** Per-request cap enforced by the contract (owner-confirmed 2026-11-13). */
  readonly capBaseUnits: string;
}

export const MAINNET_ASSETS: Readonly<Record<'NEAR' | 'USDC', MainnetAsset>> = Object.freeze({
  NEAR: { id: 'near:native', symbol: 'NEAR', decimals: 24, capBaseUnits: MAINNET_NATIVE_CAP },
  USDC: { id: MAINNET_USDC_ASSET, symbol: 'USDC', decimals: 6, capBaseUnits: MAINNET_USDC_CAP },
});

export { MAINNET_USDC, MAINNET_USDC_ASSET };

export function assetById(id: string): MainnetAsset | null {
  if (id === MAINNET_ASSETS.NEAR.id) return MAINNET_ASSETS.NEAR;
  if (id === MAINNET_ASSETS.USDC.id) return MAINNET_ASSETS.USDC;
  return null;
}

export type AmountCheck =
  | { readonly ok: true; readonly baseUnits: string }
  | { readonly ok: false; readonly reason: 'invalid' | 'precision' | 'zero' | 'cap' };

/** Exact decimal input -> base units, refusing extra precision, zero and anything above the cap. */
export function parseMainnetAmount(input: string, asset: MainnetAsset): AmountCheck {
  const text = input.trim();
  if (text === '') return { ok: false, reason: 'invalid' };
  let baseUnits: string;
  try {
    baseUnits = toBaseUnits(text, asset.decimals);
  } catch (error) {
    if (error instanceof InvalidAmountError) {
      const fraction = text.replace(',', '.').split('.')[1] ?? '';
      return { ok: false, reason: /^\d*[.,]?\d*$/.test(text) && fraction.length > asset.decimals ? 'precision' : 'invalid' };
    }
    throw error;
  }
  if (BigInt(baseUnits) === 0n) return { ok: false, reason: 'zero' };
  if (BigInt(baseUnits) > BigInt(asset.capBaseUnits)) return { ok: false, reason: 'cap' };
  return { ok: true, baseUnits };
}

/** Exact, never rounded, with the asset symbol. */
export function formatMainnetAmount(baseUnits: string, asset: MainnetAsset, locale: Locale = 'en'): string {
  return `${formatBaseUnits(baseUnits, asset.decimals, { locale, maxFractionDigits: asset.decimals }).exact} ${asset.symbol}`;
}
