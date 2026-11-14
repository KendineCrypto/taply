'use client';

import '@/lib/security/zod-jitless';
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { DICTIONARIES, LOCALE_COOKIE } from './index';
import type { Dictionary, Locale } from './types';

interface I18nValue {
  readonly locale: Locale;
  readonly t: Dictionary;
  readonly setLocale: (next: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * `dictionaries` lets another build (NEAR Mainnet) render the same components with
 * network-adapted wording; Testnet passes nothing and keeps DICTIONARIES.
 */
export function I18nProvider({ locale, children, dictionaries }: { locale: Locale; children: ReactNode; dictionaries?: Readonly<Record<Locale, Dictionary>> }) {
  const setLocale = useCallback((next: Locale) => {
    // Cookie is non-sensitive and intentionally readable by the server so the
    // first server render already uses the right dictionary (no FOUC swap).
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    window.location.reload();
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ locale, t: (dictionaries ?? DICTIONARIES)[locale], setLocale }),
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
