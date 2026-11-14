'use client';

import type { ReactNode } from 'react';
import { DICTIONARIES } from './index';
import { I18nProvider as CoreProvider } from './provider';
import type { Dictionary, Locale } from './types';

export { useLocale, useT } from './provider';

/** Testnet (and tests): the shared provider with the Testnet dictionaries by default. */
export function I18nProvider({ locale, children, dictionaries }: { locale: Locale; children: ReactNode; dictionaries?: Readonly<Record<Locale, Dictionary>> }) {
  return <CoreProvider locale={locale} dictionaries={dictionaries ?? DICTIONARIES}>{children}</CoreProvider>;
}
