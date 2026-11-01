import { describe, expect, it } from 'vitest';
import { canonicalCheckoutUrl, checkMerchantAccount, merchantCheckoutPath } from '../discovery';

describe('merchant account check', () => {
  it('accepts Testnet named, implicit and ETH-implicit accounts', () => {
    expect(checkMerchantAccount('merchant.testnet')).toEqual({ ok: true, accountId: 'merchant.testnet', kind: 'named' });
    expect(checkMerchantAccount('pos.shop-1.testnet')).toMatchObject({ ok: true, kind: 'named' });
    expect(checkMerchantAccount('a'.repeat(64))).toMatchObject({ ok: true, kind: 'implicit' });
    expect(checkMerchantAccount(`0x${'b'.repeat(40)}`)).toMatchObject({ ok: true, kind: 'eth_implicit' });
  });

  it('rejects Mainnet and bare top-level names as not Testnet', () => {
    expect(checkMerchantAccount('merchant.near')).toEqual({ ok: false, reason: 'not_testnet' });
    expect(checkMerchantAccount('testnet')).toEqual({ ok: false, reason: 'not_testnet' });
    expect(checkMerchantAccount('merchant')).toEqual({ ok: false, reason: 'not_testnet' });
  });

  it('never normalizes: uppercase, padding, encoding and separators are rejected', () => {
    for (const bad of ['Merchant.testnet', ' merchant.testnet', 'merchant.testnet ', '%6derchant.testnet', 'a..testnet', 'a/b.testnet', '', 'x', `${'a'.repeat(60)}.testnet`]) {
      expect(checkMerchantAccount(bad).ok, bad).toBe(false);
    }
  });
});

describe('discovery links', () => {
  it('builds the in-app path and the one canonical URL', () => {
    expect(merchantCheckoutPath('merchant.testnet')).toBe('/checkout/merchant.testnet');
    expect(canonicalCheckoutUrl('https://taply.app', 'merchant.testnet')).toBe('https://taply.app/checkout/merchant.testnet');
    expect(canonicalCheckoutUrl('https://taply.app/', 'merchant.testnet')).toBe('https://taply.app/checkout/merchant.testnet');
  });

  it('refuses non-shareable origins and invalid accounts', () => {
    expect(() => canonicalCheckoutUrl('http://localhost:3000', 'merchant.testnet')).toThrow();
    expect(() => canonicalCheckoutUrl('https://100.64.0.1', 'merchant.testnet')).toThrow();
    expect(() => canonicalCheckoutUrl('https://taply.app', 'merchant.near')).toThrow();
    expect(() => merchantCheckoutPath('../pay/x')).toThrow();
  });

  it('a discovery URL carries no amount, request or recipient parameter', () => {
    const url = new URL(canonicalCheckoutUrl('https://taply.app', 'merchant.testnet'));
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.pathname).toBe('/checkout/merchant.testnet');
  });
});
