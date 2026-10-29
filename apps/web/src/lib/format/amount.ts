import type { Locale } from '@/lib/i18n';
import { U128_MAX } from '@/lib/protocol';
import type { U128 } from '@/lib/protocol';

/**
 * Base-unit amount formatting.
 *
 * SECURITY.md section 5 / freeze section 3: all amount arithmetic is u128 base
 * units as canonical decimal strings. No JS floating point is permitted anywhere
 * in this path - not Number(), not parseFloat, not Intl.NumberFormat (which
 * takes a number). Grouping separators are applied by string surgery with a
 * per-locale lookup instead.
 */

export class InvalidAmountError extends Error {
  constructor(value: string) {
    super(`Not a canonical base-unit decimal string: ${JSON.stringify(value)}`);
    this.name = 'InvalidAmountError';
  }
}

const BASE_UNITS_PATTERN = /^(0|[1-9][0-9]*)$/;

// u128 maximum comes from @taply/shared; never redefined here.
export function isBaseUnitString(value: string): boolean {
  if (!BASE_UNITS_PATTERN.test(value)) return false;
  return BigInt(value) <= U128_MAX;
}

export function parseBaseUnits(value: U128): bigint {
  if (!isBaseUnitString(value)) throw new InvalidAmountError(value);
  return BigInt(value);
}

interface Separators {
  readonly group: string;
  readonly decimal: string;
}

const SEPARATORS: Readonly<Record<Locale, Separators>> = {
  en: { group: ',', decimal: '.' },
  tr: { group: '.', decimal: ',' },
};

function groupIntegerDigits(digits: string, group: string): string {
  let out = '';
  let count = 0;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out = digits[i]! + out;
    count += 1;
    if (count % 3 === 0 && i > 0) out = group + out;
  }
  return out;
}

export interface FormattedAmount {
  /**
   * Full precision, no rounding, no truncation. This is what the review sheet
   * and the receipt must show.
   */
  readonly exact: string;
  /** Shortened for dense chrome. `truncated` tells you digits were dropped. */
  readonly display: string;
  readonly truncated: boolean;
  /** Unformatted canonical base-unit string, for copy-to-clipboard and aria. */
  readonly baseUnits: U128;
}

export interface FormatOptions {
  readonly locale?: Locale;
  /** Digits kept after the decimal separator in `display`. Default 5. */
  readonly maxFractionDigits?: number;
}

/**
 * Formats base units into human text. Always truncates toward zero - money is
 * never rounded up for display.
 */
export function formatBaseUnits(
  baseUnits: U128,
  decimals: number,
  options: FormatOptions = {},
): FormattedAmount {
  const value = parseBaseUnits(baseUnits);
  const locale: Locale = options.locale ?? 'en';
  const maxFractionDigits = options.maxFractionDigits ?? 5;
  const separators = SEPARATORS[locale];

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new RangeError(`Unsupported decimals: ${decimals}`);
  }

  const asString = value.toString();
  const padded = asString.padStart(decimals + 1, '0');
  const integerDigits = padded.slice(0, padded.length - decimals);
  const fractionDigits = decimals === 0 ? '' : padded.slice(padded.length - decimals);

  const groupedInteger = groupIntegerDigits(integerDigits, separators.group);

  const exactFraction = fractionDigits.replace(/0+$/, '');
  const exact =
    exactFraction.length > 0 ? `${groupedInteger}${separators.decimal}${exactFraction}` : groupedInteger;

  const kept = fractionDigits.slice(0, maxFractionDigits).replace(/0+$/, '');
  const dropped = fractionDigits.slice(maxFractionDigits);
  const truncated = /[1-9]/.test(dropped);
  const display = kept.length > 0 ? `${groupedInteger}${separators.decimal}${kept}` : groupedInteger;

  return { exact, display, truncated, baseUnits: asString };
}

/**
 * Converts a human decimal input (what someone types) into base units, exactly.
 * Rejects anything it cannot represent without loss, rather than rounding.
 */
export function toBaseUnits(input: string, decimals: number): U128 {
  const trimmed = input.trim().replace(/\s+/g, '');
  if (!/^(0|[1-9][0-9]*)?([.,][0-9]*)?$/.test(trimmed) || trimmed === '' || trimmed === '.' || trimmed === ',') {
    throw new InvalidAmountError(input);
  }

  const normalized = trimmed.replace(',', '.');
  const [wholePart = '', fractionPart = ''] = normalized.split('.');

  if (fractionPart.length > decimals) {
    // More precision than the asset has. Refusing is correct: silently dropping
    // digits would change the amount the user agreed to.
    throw new InvalidAmountError(input);
  }

  const whole = wholePart === '' ? '0' : wholePart;
  const fraction = fractionPart.padEnd(decimals, '0');
  const combined = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');

  if (!isBaseUnitString(combined)) throw new InvalidAmountError(input);
  return combined;
}
