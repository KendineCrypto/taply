'use client';

// Must run before any schema parses (Zod's eval probe trips the CSP otherwise).
import '@/lib/security/zod-jitless';
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { mainnetEn } from '@/lib/i18n/dictionaries/mainnet-en';
import type { MainnetCopy } from '@/lib/i18n/dictionaries/mainnet-en';
import { mainnetTr } from '@/lib/i18n/dictionaries/mainnet-tr';
import type { Locale } from '@/lib/i18n/types';

/**
 * Mainnet locale + copy. Deliberately independent of the Testnet
 * `I18nProvider`, which bundles the full Testnet dictionaries: a mainnet build
 * ships only the mainnet copy. Same cookie as the Testnet build.
 */
export const MAINNET_COPY: Readonly<Record<Locale, MainnetCopy>> = { en: mainnetEn, tr: mainnetTr };
const LOCALE_COOKIE = 'taply_locale';

interface LocaleValue {
  readonly locale: Locale;
  readonly setLocale: (next: Locale) => void;
}
const LocaleContext = createContext<LocaleValue | null>(null);

export function MainnetLocaleProvider({ locale, children }: { readonly locale: Locale; readonly children: ReactNode }) {
  const setLocale = useCallback((next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    window.location.reload();
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useMainnetLocale(): LocaleValue {
  const v = useContext(LocaleContext);
  if (!v) throw new Error('useMainnetLocale must be used inside <MainnetLocaleProvider>');
  return v;
}

export function useMainnetCopy(): MainnetCopy {
  return MAINNET_COPY[useMainnetLocale().locale];
}

/** `{name}` placeholders as plain text; unknown placeholders stay visible. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
