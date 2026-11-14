import type { Dictionary, Locale } from './types';

/**
 * Build-time rules (no Testnet module is imported here). The generated JSON next to this
 * file is what the NEAR Mainnet bundle loads, so the raw Testnet dictionaries never ship
 * in it; __tests__/mainnet-dictionaries.test.ts keeps the JSON in sync with these rules.
 *
 * The Testnet product dictionaries with network wording adapted for the NEAR Mainnet
 * build, so the existing Taply components render unchanged. Only words change:
 * Testnet-only flows (faucet, username provisioning) are never rendered on Mainnet.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/NEAR Testnet/g, 'NEAR Mainnet'],
  [/Test funds only\./g, 'Real funds.'],
  [/Yalnızca test fonları\./g, 'Gerçek para.'],
  [/\btest NEAR\b/gi, 'NEAR'],
  [/Testnet/g, 'Mainnet'],
  [/testnet/g, 'mainnet'],
  [/faucet/g, 'network'],
  [/Faucet/g, 'Network'],
];

function adaptString(s: string): string {
  return RULES.reduce((acc, [re, to]) => acc.replace(re, to), s);
}

function adapt<T>(value: T): T {
  if (typeof value === 'string') return adaptString(value) as T;
  if (typeof value === 'function') {
    const fn = value as unknown as (...args: unknown[]) => unknown;
    return ((...args: unknown[]) => adapt(fn(...args))) as T;
  }
  if (Array.isArray(value)) return value.map((v) => adapt(v)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, adapt(v)])) as T;
  }
  return value;
}

/** Strings that describe Testnet-only mechanics (faucet, username provisioning, send preview). */
function override(d: Dictionary, locale: Locale): Dictionary {
  const en = locale === 'en';
  return {
    ...d,
    walletNative: {
      ...d.walletNative,
      chooser: {
        ...d.walletNative.chooser,
        taply: {
          ...d.walletNative.chooser.taply,
          body: en
            ? 'A 12-word wallet created and encrypted on this device. It becomes active when it receives NEAR on Mainnet.'
            : 'Bu cihazda oluşturulan ve şifrelenen 12 kelimelik cüzdan. Mainnet’te NEAR aldığında etkinleşir.',
        },
        taplyCta: en ? 'Create a Taply Wallet' : 'Taply Cüzdan oluştur',
      },
    },
    oneTap: {
      ...d.oneTap,
      sheet: {
        ...d.oneTap.sheet,
        send: { ...d.oneTap.sheet.send, body: en ? 'Send NEAR or USDC from your wallet.' : 'Cüzdanından NEAR veya USDC gönder.' },
      },
    },
  };
}

export function buildMainnetDictionaries(source: Readonly<Record<Locale, Dictionary>>): Readonly<Record<Locale, Dictionary>> {
  return { en: override(adapt(source.en), 'en'), tr: override(adapt(source.tr), 'tr') };
}
