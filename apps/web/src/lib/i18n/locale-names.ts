import type { Locale } from './types';

/** Each language's own name (same as `localeName` in its dictionary; checked by a test). No dictionary import. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', tr: 'Türkçe' };
