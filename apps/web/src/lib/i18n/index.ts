import { en } from './dictionaries/en';
import { tr } from './dictionaries/tr';
import { DEFAULT_LOCALE, LOCALES, isLocale } from './types';
import type { Dictionary, Locale } from './types';

export { DEFAULT_LOCALE, LOCALES, isLocale };
export type { Dictionary, Locale, ErrorCopy, PhaseCopy, StatusCopy } from './types';

/**
 * Freeze section 9: default English, secondary Turkish, "all status translations
 * consistent". Consistency is enforced two ways:
 *  - compile time: every dictionary must satisfy the `Dictionary` interface,
 *    whose status/error/phase maps are Records keyed by the protocol enums;
 *  - runtime: `src/lib/i18n/__tests__/dictionaries.test.ts` compares key shapes.
 */
export const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { en, tr };

export const LOCALE_COOKIE = 'taply_locale';

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/**
 * Resolves a locale from a cookie value first (explicit user choice), then from
 * an Accept-Language header, then the default. No locale route prefix is used,
 * which keeps the frozen route list in section 9 unchanged.
 */
export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;

  if (acceptLanguage) {
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';')[0]?.trim().toLowerCase();
      if (!tag) continue;
      const base = tag.split('-')[0];
      if (isLocale(base)) return base;
    }
  }

  return DEFAULT_LOCALE;
}
