import type { Dictionary, Locale } from './types';
import data from './mainnet-dictionaries.generated.json';

/**
 * Testnet product wording adapted for NEAR Mainnet (rules: ./mainnet-dictionary-rules.ts).
 * Pre-generated so the Mainnet bundle carries no raw Testnet dictionary; the sync test
 * (__tests__/mainnet-dictionaries.test.ts) fails if this JSON drifts from en/tr + rules.
 * Regenerate: TAPLY_WRITE_MAINNET_DICT=1 npx vitest run src/lib/i18n/__tests__/mainnet-dictionaries.test.ts
 */
export const MAINNET_DICTIONARIES = data as unknown as Readonly<Record<Locale, Dictionary>>;
