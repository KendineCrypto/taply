import { describe, expect, it } from 'vitest';
import { parsePayInput, parseScanInput } from '../pay-link';

const ORIGIN = 'https://pay.taply.app';
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';

describe('parseScanInput (pay requests + merchant discovery)', () => {
  it('still opens pay links and bare IDs exactly as parsePayInput does', () => {
    for (const input of [ID, `${ORIGIN}/pay/${ID}`, `${ORIGIN}/pay/${ID}?amount=9#x`, 'https://evil.app/pay/' + ID, 'nonsense']) {
      expect(parseScanInput(input, [ORIGIN])).toEqual(parsePayInput(input, [ORIGIN]));
    }
  });

  it('recognizes an approved-origin discovery link and keeps only the account', () => {
    expect(parseScanInput(`${ORIGIN}/checkout/shop.testnet`, [ORIGIN])).toEqual({ kind: 'merchant', accountId: 'shop.testnet' });
    expect(parseScanInput(`${ORIGIN}/checkout/shop.testnet/`, [ORIGIN])).toEqual({ kind: 'merchant', accountId: 'shop.testnet' });
    // No query-based recipient substitution, no amount, no wallet action.
    expect(parseScanInput(`${ORIGIN}/checkout/shop.testnet?recipient=evil.testnet&amount=1&transactionHashes=x#y`, [ORIGIN])).toEqual({
      kind: 'merchant',
      accountId: 'shop.testnet',
    });
  });

  it('names another site instead of following it', () => {
    expect(parseScanInput('https://taply.evil.app/checkout/shop.testnet', [ORIGIN])).toEqual({ kind: 'other_site', host: 'taply.evil.app' });
  });

  it('explains invalid or non-Testnet merchant accounts', () => {
    expect(parseScanInput(`${ORIGIN}/checkout/shop.near`, [ORIGIN])).toEqual({ kind: 'invalid_merchant', reason: 'not_testnet' });
    expect(parseScanInput(`${ORIGIN}/checkout/Shop.testnet`, [ORIGIN])).toEqual({ kind: 'invalid_merchant', reason: 'syntax' });
    expect(parseScanInput(`${ORIGIN}/checkout/%73hop.testnet`, [ORIGIN])).toEqual({ kind: 'invalid_merchant', reason: 'syntax' });
  });

  it('rejects everything else: other paths, schemes, credentials, invisible characters and bare account IDs', () => {
    for (const input of [
      'shop.testnet',
      `${ORIGIN}/checkout/shop.testnet/pay`,
      `${ORIGIN}/checkout/`,
      `${ORIGIN}/merchant/shop.testnet`,
      'javascript:alert(1)//checkout/shop.testnet',
      'data:text/html,/checkout/shop.testnet',
      `https://user:pw@pay.taply.app/checkout/shop.testnet`,
      `${ORIGIN}/checkout/shop​.testnet`,
      `${ORIGIN}/checkout/${'a'.repeat(3000)}`,
    ]) {
      const parsed = parseScanInput(input, [ORIGIN]);
      expect(['invalid', 'invalid_merchant'], input).toContain(parsed.kind);
    }
  });
});
