import { describe, expect, it } from 'vitest';
import { emptyProductData, loadProductData, saveProductData, productStorageKey, splitMainnetAmount, parseMainnetScan, PRODUCT_ROUTES } from '../product';
import { routeDecision } from '../build';
import { productEn, productTr } from '../product-copy';
describe('Mainnet full product boundaries', () => {
  it('rejects unknown Mainnet destinations before a streamed response can return HTTP 200', () => {
    expect(routeDecision('/m/not-a-product', true).kind).toBe('not_found');
    expect(routeDecision('/m/checkout/alice.testnet', true).kind).toBe('not_found');
  });
  it.each(PRODUCT_ROUTES)('routes %s to a Mainnet component and leaves Testnet untouched', path => {
    expect(routeDecision(`/${path}`, true)).toEqual({ kind: 'redirect', location: `/m/${path}` });
    expect(routeDecision(`/${path}`, false)).toEqual({ kind: 'pass' });
    expect(routeDecision(`/m/${path}`, false).kind).toBe('rewrite_not_found');
  });
  it('keeps all translated product keys', () => { expect(Object.keys(productEn).sort()).toEqual(Object.keys(productTr).sort()); });
  it('accepts only same-origin payment/merchant QR, never foreign, credential, query or fragment payloads', () => {
    const origin = 'https://mainnet.taplyapp.xyz'; const id = 'a'.repeat(64);
    expect(parseMainnetScan(`${origin}/m/pay/${id}`, origin)).toBe(`/m/pay/${id}`);
    expect(parseMainnetScan(id, origin)).toBe(`/m/pay/${id}`);
    for (const url of [`https://taplyapp.xyz/m/pay/${id}`, `${origin}/pay/${id}`, `${origin}/m/pay/${id}?x=1`, `${origin}/m/pay/${id}#k=secret`, `https://foo@mainnet.taplyapp.xyz/m/pay/${id}`, `${origin}/m/checkout/alice.testnet`]) expect(parseMainnetScan(url, origin)).toBeNull();
  });
  it('isolates account and network storage and refuses malformed data without overwriting', () => {
    const map = new Map<string, string>(); const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
    const data = { ...emptyProductData(), contacts: [{ id: 'bob.near', label: 'Bob' }] };
    saveProductData(storage, 'alice.near', data); expect(loadProductData(storage, 'alice.near')).toEqual(data);
    expect(loadProductData(storage, 'bob.near')).toEqual(emptyProductData());
    expect(() => productStorageKey('alice.testnet')).toThrow();
    map.set(productStorageKey('alice.near'), 'invalid'); expect(() => loadProductData(storage, 'alice.near')).toThrow();
    expect(map.get(productStorageKey('alice.near'))).toBe('invalid');
  });
  it('conserves exact units for every split and refuses zero shares', () => {
    for (let count = 2; count <= 50; count++) {
      const total = '1000000000000000000000000'; const shares = splitMainnetAmount(total, count);
      expect(shares.reduce((sum, v) => sum + BigInt(v), 0n)).toBe(BigInt(total));
      expect(BigInt(shares[0]!) - BigInt(shares.at(-1)!)).toBeLessThanOrEqual(1n);
    }
    expect(() => splitMainnetAmount('1', 2)).toThrow(); expect(() => splitMainnetAmount('1.5', 2)).toThrow();
  });
  it('rejects tampered draft caps and invalid amounts before rendering or writing', () => {
    const store = { setItem: () => { throw new Error('MUST_NOT_WRITE'); } };
    const draft = { id: 'b50f7d10-f65f-4dad-bd16-87829ba44a62', kind: 'personal' as const, recipient: 'alice.near', amount: '25000001', asset: 'USDC' as const, note: '', cadence: 'weekly' as const, design: 0 };
    for (const amount of ['25000001', '999999999999999999999999999999999999999', '-1']) {
      expect(() => saveProductData(store, 'alice.near', { ...emptyProductData(), drafts: [{ ...draft, amount }] })).toThrow();
      expect(() => loadProductData({ getItem: () => JSON.stringify({ ...emptyProductData(), drafts: [{ ...draft, amount }] }) }, 'alice.near')).toThrow();
    }
  });
});
