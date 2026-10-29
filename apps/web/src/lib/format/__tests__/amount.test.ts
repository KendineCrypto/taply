import { describe, expect, it } from 'vitest';
import {
  InvalidAmountError,
  formatBaseUnits,
  isBaseUnitString,
  parseBaseUnits,
  toBaseUnits,
} from '../amount';

const NEAR_DECIMALS = 24;

describe('base-unit validation', () => {
  it('accepts canonical non-negative integer strings', () => {
    for (const value of ['0', '1', '1000000000000000000000000']) {
      expect(isBaseUnitString(value)).toBe(true);
    }
  });

  it('rejects anything that is not a canonical decimal string', () => {
    for (const value of ['', ' 1', '1 ', '+1', '-1', '1.0', '1e24', '0x1', '01', 'NaN', 'Infinity']) {
      expect(isBaseUnitString(value), value).toBe(false);
      expect(() => parseBaseUnits(value)).toThrow(InvalidAmountError);
    }
  });

  it('rejects values above u128 max', () => {
    const max = ((1n << 128n) - 1n).toString();
    expect(isBaseUnitString(max)).toBe(true);
    expect(isBaseUnitString((BigInt(max) + 1n).toString())).toBe(false);
  });
});

describe('formatBaseUnits precision', () => {
  it('formats exactly 1 NEAR', () => {
    const result = formatBaseUnits('1000000000000000000000000', NEAR_DECIMALS);
    expect(result.exact).toBe('1');
    expect(result.display).toBe('1');
    expect(result.truncated).toBe(false);
  });

  it('keeps full precision in `exact` and never rounds', () => {
    // 1.000000000000000000000001 NEAR - the smallest possible increment.
    const result = formatBaseUnits('1000000000000000000000001', NEAR_DECIMALS);
    expect(result.exact).toBe('1.000000000000000000000001');
    // Display truncates toward zero and says so, rather than rounding to 1.
    expect(result.display).toBe('1');
    expect(result.truncated).toBe(true);
  });

  it('does not round up a value just under the next unit', () => {
    const justUnderTwo = (2n * 10n ** 24n - 1n).toString();
    const result = formatBaseUnits(justUnderTwo, NEAR_DECIMALS);
    expect(result.display.startsWith('1.99999')).toBe(true);
    expect(result.display).not.toBe('2');
    expect(result.truncated).toBe(true);
  });

  it('formats sub-unit amounts without losing digits', () => {
    const result = formatBaseUnits('1', NEAR_DECIMALS);
    expect(result.exact).toBe('0.000000000000000000000001');
    expect(result.display).toBe('0');
    expect(result.truncated).toBe(true);
  });

  it('handles zero', () => {
    const result = formatBaseUnits('0', NEAR_DECIMALS);
    expect(result.exact).toBe('0');
    expect(result.display).toBe('0');
    expect(result.truncated).toBe(false);
  });

  it('survives amounts far beyond IEEE-754 integer precision', () => {
    // 2^53 + 1 base units: a Number-based implementation would lose this digit.
    const beyondDouble = (2n ** 53n + 1n).toString();
    const result = formatBaseUnits(beyondDouble, 0);
    expect(result.exact.replace(/,/g, '')).toBe(beyondDouble);
    expect(result.baseUnits).toBe(beyondDouble);
  });

  it('groups integer digits per locale', () => {
    const amount = (1234567n * 10n ** 24n).toString();
    expect(formatBaseUnits(amount, NEAR_DECIMALS, { locale: 'en' }).display).toBe('1,234,567');
    expect(formatBaseUnits(amount, NEAR_DECIMALS, { locale: 'tr' }).display).toBe('1.234.567');
  });

  it('uses the locale decimal separator', () => {
    const amount = (15n * 10n ** 23n).toString(); // 1.5 NEAR
    expect(formatBaseUnits(amount, NEAR_DECIMALS, { locale: 'en' }).exact).toBe('1.5');
    expect(formatBaseUnits(amount, NEAR_DECIMALS, { locale: 'tr' }).exact).toBe('1,5');
  });

  it('respects maxFractionDigits', () => {
    const amount = '1234500000000000000000000'; // 1.2345 NEAR
    expect(formatBaseUnits(amount, NEAR_DECIMALS, { maxFractionDigits: 2 }).display).toBe('1.23');
    expect(formatBaseUnits(amount, NEAR_DECIMALS, { maxFractionDigits: 2 }).truncated).toBe(true);
    expect(formatBaseUnits(amount, NEAR_DECIMALS, { maxFractionDigits: 6 }).truncated).toBe(false);
  });

  it('always exposes the raw base units for copy and aria', () => {
    const result = formatBaseUnits('42', NEAR_DECIMALS);
    expect(result.baseUnits).toBe('42');
  });
});

describe('toBaseUnits', () => {
  it('converts human input exactly', () => {
    expect(toBaseUnits('1', NEAR_DECIMALS)).toBe('1000000000000000000000000');
    expect(toBaseUnits('0.5', NEAR_DECIMALS)).toBe('500000000000000000000000');
    expect(toBaseUnits('1.5', NEAR_DECIMALS)).toBe('1500000000000000000000000');
    expect(toBaseUnits('0', NEAR_DECIMALS)).toBe('0');
    expect(toBaseUnits('.5', NEAR_DECIMALS)).toBe('500000000000000000000000');
  });

  it('accepts a comma decimal separator for Turkish input', () => {
    expect(toBaseUnits('1,5', NEAR_DECIMALS)).toBe('1500000000000000000000000');
  });

  it('refuses input with more precision than the asset has', () => {
    const tooPrecise = `0.${'0'.repeat(NEAR_DECIMALS)}1`;
    expect(() => toBaseUnits(tooPrecise, NEAR_DECIMALS)).toThrow(InvalidAmountError);
  });

  it('refuses malformed input rather than guessing', () => {
    for (const value of ['', '.', ',', 'abc', '1.2.3', '-1', '1e5']) {
      expect(() => toBaseUnits(value, NEAR_DECIMALS), value).toThrow(InvalidAmountError);
    }
  });

  it('round-trips through formatBaseUnits', () => {
    for (const human of ['1', '0.5', '123.456', '0.000001']) {
      const base = toBaseUnits(human, NEAR_DECIMALS);
      expect(formatBaseUnits(base, NEAR_DECIMALS, { maxFractionDigits: NEAR_DECIMALS }).exact).toBe(human);
    }
  });
});
