'use client';

import '@/lib/security/zod-jitless';
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { LOCALE_COOKIE } from './cookie';
import type { Dictionary, Locale } from './types';

interface I18nValue {
  readonly locale: Locale;
  readonly t: Dictionary;
  readonly setLocale: (next: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Imports no dictionary: each build passes its own (Testnet: ./testnet-provider with
 * DICTIONARIES; NEAR Mainnet: the generated Mainnet dictionaries), so the Mainnet bundle
 * never carries the raw Testnet wording.
 */
export function I18nProvider({ locale, children, dictionaries }: { locale: Locale; children: ReactNode; dictionaries: Readonly<Record<Locale, Dictionary>> }) {
  const setLocale = useCallback((next: Locale) => {
    // Cookie is non-sensitive and intentionally readable by the server so the
    // first server render already uses the right dictionary (no FOUC swap).
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    window.location.reload();
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ locale, t: dictionaries[locale], setLocale }),
    [locale, setLocale, dictionaries],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}

/** Returns the whole dictionary. Keys are fully typed, so typos fail to compile. */
export function useT(): Dictionary {
  return useI18n().t;
}

export function useLocale(): { locale: Locale; setLocale: (next: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}
