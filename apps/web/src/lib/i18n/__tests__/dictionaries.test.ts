import { describe, expect, it } from 'vitest';
import { ASSURANCES, CHAIN_STATES, ERROR_CODES, LOCAL_PHASES, SESSION_STATES } from '@/lib/protocol';
import type { ChainState } from '@/lib/protocol';
import { DICTIONARIES, LOCALES, resolveLocale } from '../index';
import type { Dictionary } from '../types';

/**
 * Freeze section 9: "Default English, secondary Turkish, all status translations
 * consistent." The Dictionary interface enforces shape at compile time; these
 * tests catch the things types cannot: empty strings, forgotten enum members,
 * and copy that contradicts the payment-state rules.
 */

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('dictionary completeness', () => {
  it('exposes exactly the declared locales', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...LOCALES].sort());
  });

  it('has identical key structure across every locale', () => {
    const [first, ...rest] = LOCALES;
    const reference = keyPaths(DICTIONARIES[first!]).sort();
    for (const locale of rest) {
      expect(keyPaths(DICTIONARIES[locale]).sort(), locale).toEqual(reference);
    }
  });

  it('has no empty or placeholder strings', () => {
    for (const locale of LOCALES) {
      for (const path of keyPaths(DICTIONARIES[locale])) {
        const value = path
          .split('.')
          .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], DICTIONARIES[locale]);
        expect(typeof value, `${locale}.${path}`).toBe('string');
        expect((value as string).trim().length, `${locale}.${path}`).toBeGreaterThan(0);
        expect(value as string, `${locale}.${path}`).not.toMatch(/\bTODO\b|\bTBD\b|\bFIXME\b/i);
      }
    }
  });

  it('covers every protocol enum member', () => {
    for (const locale of LOCALES) {
      const dict: Dictionary = DICTIONARIES[locale];
      expect(Object.keys(dict.status).sort()).toEqual([...CHAIN_STATES].sort());
      expect(Object.keys(dict.localPhase).sort()).toEqual([...LOCAL_PHASES].sort());
      expect(Object.keys(dict.sessionState).sort()).toEqual([...SESSION_STATES].sort());
      expect(Object.keys(dict.assurance).sort()).toEqual([...ASSURANCES].sort());
      expect(Object.keys(dict.errors).sort()).toEqual([...ERROR_CODES].sort());
    }
  });
});

describe('status copy cannot contradict the payment rules', () => {
  /** States where claiming the recipient has the money would be a lie. */
  const NOT_PAID_STATES = CHAIN_STATES.filter((s) => s !== 'FINAL_PAID');

  /**
   * `Object.entries` widens an interface to `[string, any][]`, which silently
   * disables inference in the checks below. Narrow it once, here.
   */
  function statusFields(dict: Dictionary, state: ChainState): ReadonlyArray<[string, string]> {
    return Object.entries(dict.status[state]) as Array<[string, string]>;
  }

  /**
   * A sentence may mention "paid" only to deny it. Checking per sentence rather
   * than per string avoids both false positives ("nothing was paid") and the
   * false negative of a denial elsewhere in the paragraph excusing a claim.
   */
  const NEGATION = /\bnot\b|\bnever\b|\bnothing\b|\bno\b|\bcannot\b|n't\b/;

  function positivePaidClaims(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => /\bpaid\b/i.test(sentence) && !NEGATION.test(sentence.toLowerCase()));
  }

  it('never uses a positive paid claim for a not-paid state (English)', () => {
    const dict = DICTIONARIES.en;
    for (const state of NOT_PAID_STATES) {
      for (const [field, text] of statusFields(dict, state)) {
        expect(positivePaidClaims(text), `en.status.${state}.${field}: "${text}"`).toEqual([]);
      }
    }
  });

  it('does allow FINAL_PAID to claim payment', () => {
    const copy = DICTIONARIES.en.status.FINAL_PAID;
    expect(copy.label.toLowerCase()).toBe('paid');
    expect(copy.payer.toLowerCase()).toContain('verified');
  });

  /**
   * Turkish negates with suffixes rather than a separate word, so the claim
   * tokens are matched only at a token boundary ("ulaştı" but not "ulaştığı")
   * and a sentence carrying any negation marker is treated as a denial.
   *
   * Claim tokens:     ödendi (was paid), ulaştı (arrived)
   * Negation markers: -medi/-madı (did not), -mez/-maz (cannot), değil (is not),
   *                   henüz (not yet), yok (none), and the "ne ... ne ..."
   *                   (neither/nor) correlative, which negates without a suffix.
   *
   * No `g` flag: these are reused across iterations and `.test()` on a global
   * regex advances `lastIndex`, which would make results depend on call order.
   */
  const TR_CLAIM = /(ödendi|ulaştı)(?![a-zçğıöşü])/i;
  const TR_NEGATION = /medi|madı|mez|maz|değil|henüz|yok|mayacak|meyecek|\bne\b[^.]*\bne\b/i;

  it('never uses a positive paid claim for a not-paid state (Turkish)', () => {
    const dict = DICTIONARIES.tr;
    for (const state of NOT_PAID_STATES) {
      for (const [field, text] of statusFields(dict, state)) {
        const offending = text
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => TR_CLAIM.test(sentence) && !TR_NEGATION.test(sentence));
        expect(offending, `tr.status.${state}.${field}: "${text}"`).toEqual([]);
      }
    }
  });

  it('does allow the Turkish FINAL_PAID copy to claim payment', () => {
    const copy = DICTIONARIES.tr.status.FINAL_PAID;
    expect(copy.payer).toContain('ulaştı');
    expect(TR_NEGATION.test(copy.payer)).toBe(false);
  });

  it('labels LOCKED as not paid in both locales', () => {
    expect(DICTIONARIES.en.status.LOCKED.label.toLowerCase()).toContain('not paid');
    expect(DICTIONARIES.en.status.LOCKED.recipient).toContain('NOT PAID');
    expect(DICTIONARIES.tr.status.LOCKED.label).toContain('ödenmedi');
    expect(DICTIONARIES.tr.status.LOCKED.recipient).toContain('ÖDENMEDİ');
  });

  it('labels CANCELLED_REFUNDED as refunded, not paid, in both locales', () => {
    expect(DICTIONARIES.en.status.CANCELLED_REFUNDED.label.toLowerCase()).toBe('refunded');
    expect(DICTIONARIES.tr.status.CANCELLED_REFUNDED.label).toBe('İade edildi');
  });

  it('warns against re-paying in the uncertain-outcome copy', () => {
    expect(DICTIONARIES.en.localPhase.OUTCOME_UNKNOWN.description.toLowerCase()).toContain('do not pay again');
    expect(DICTIONARIES.en.errors.RPC_TIMEOUT_UNKNOWN_STATUS.body.toLowerCase()).toContain('do not retry');
    expect(DICTIONARIES.tr.localPhase.OUTCOME_UNKNOWN.description).toContain('zincir durumunu kontrol');
  });

  it('keeps the frozen Protected pre-funding consent copy verbatim (English)', () => {
    // Freeze section 9 specifies this string exactly; it supersedes older specs
    // that demanded a precise pre-funding timestamp.
    expect(DICTIONARIES.en.protectedPay.preFundingConsent).toBe(
      'You can cancel for 60 seconds starting when this payment funds on-chain; on-chain execution time determines whether cancellation succeeds. Release requires a separate transaction after that period.',
    );
  });

  it('never states a precise pre-funding cutoff timestamp', () => {
    for (const locale of LOCALES) {
      const copy = DICTIONARIES[locale].protectedPay.preFundingConsent;
      expect(copy).not.toMatch(/\d{1,2}:\d{2}/);
      expect(copy).not.toMatch(/UTC/);
    }
  });

  it('describes the comparison code as a non-identity aid in both locales', () => {
    expect(DICTIONARIES.en.handshake.notIdentityProof.toLowerCase()).toContain('not proof of identity');
    expect(DICTIONARIES.tr.handshake.notIdentityProof).toContain('Kimlik kanıtı değildir');
  });

  it('describes the permanent merchant QR as discovery, not an invoice', () => {
    expect(DICTIONARIES.en.checkout.permanentQrIsDiscovery.toLowerCase()).toContain('not a payable invoice');
    expect(DICTIONARIES.tr.checkout.permanentQrIsDiscovery).toContain('Ödenebilir bir fatura değildir');
  });
});

describe('resolveLocale', () => {
  it('prefers an explicit cookie choice', () => {
    expect(resolveLocale('tr', 'en-US,en;q=0.9')).toBe('tr');
    expect(resolveLocale('en', 'tr-TR')).toBe('en');
  });

  it('falls back to Accept-Language', () => {
    expect(resolveLocale(undefined, 'tr-TR,tr;q=0.9,en;q=0.8')).toBe('tr');
    expect(resolveLocale(undefined, 'en-GB,en;q=0.9')).toBe('en');
  });

  it('defaults to English for unknown or missing input', () => {
    expect(resolveLocale(undefined, undefined)).toBe('en');
    expect(resolveLocale('de', 'de-DE')).toBe('en');
    expect(resolveLocale(undefined, '')).toBe('en');
  });
});
