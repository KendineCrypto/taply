import { describe, expect, it } from 'vitest';
import { decodePersonalGift, encodePersonalGift } from '../personal-gift';
import type { PersonalGiftPayload } from '../personal-gift';
import { resolveGiftProfile } from '../gift-profile';
import { CANCEL_MINUTES, FUNDING_MINUTES, minutesToNs, randomCreationNonce, resolveEscrowProfile } from '../escrow-profile';
import { matchesActivityFilter } from '@/components/mainnet/Activity';
import { saleRequestId } from '@/components/mainnet/Merchant';
import { isProductRoute } from '../product';

const HASH = 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf';
const OTHER = '9MzUv5RVWHpJdWcrnW9dXk8z4bRDNGKSyGbt4GaVnsS8';
const NET = { rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear' };

describe('Personal Gift fragment payload (no secrets, strict)', () => {
  const base: PersonalGiftPayload = { v: 1, network: 'near-mainnet', from: 'alice.near', to: 'bob.near',
    amountYocto: '250000000000000000000000', txHash: HASH, message: 'İyi ki doğdun 🎉', design: 2 };
  it('round-trips through #p= base64url', () => {
    const hash = encodePersonalGift(base);
    expect(hash).toMatch(/^#p=[A-Za-z0-9_-]+$/);
    expect(decodePersonalGift(hash)).toEqual(base);
  });
  it('carries no key material', () => {
    const json = JSON.stringify(base);
    expect(json).not.toMatch(/ed25519:|seed|private|secret/i);
    expect(Object.keys(base).sort()).toEqual(['amountYocto', 'design', 'from', 'message', 'network', 'to', 'txHash', 'v']);
  });
  it.each([
    ['', 'empty'], ['#k=abc', 'other fragment'], ['#p=!!!', 'bad alphabet'],
    [encodePersonalGift(base) + 'x', 'tampered tail'],
  ])('rejects %s (%s)', (hash) => { expect(decodePersonalGift(hash)).toBeNull(); });
  it('rejects self gifts, Testnet, zero amounts, extra keys and long messages', () => {
    const enc = (v: unknown) => `#p=${Buffer.from(JSON.stringify(v)).toString('base64url')}`;
    expect(decodePersonalGift(enc({ ...base, to: 'alice.near' }))).toBeNull();
    expect(decodePersonalGift(enc({ ...base, network: 'near-testnet' }))).toBeNull();
    expect(decodePersonalGift(enc({ ...base, amountYocto: '0' }))).toBeNull();
    expect(decodePersonalGift(enc({ ...base, seed: 'aa' }))).toBeNull();
    expect(decodePersonalGift(enc({ ...base, message: 'x'.repeat(281) }))).toBeNull();
    expect(() => encodePersonalGift({ ...base, to: 'alice.near' })).toThrow();
  });
});

describe('Gift and escrow profiles fail closed', () => {
  const gift = { contractId: 'gift-candidate.near', codeHash: HASH, min: '100000000000000000000000', max: '1000000000000000000000000', fee: '10000000000000000000000' };
  it('Gift: all five set → profile; any missing → null; no network → null', () => {
    expect(resolveGiftProfile(gift, NET)?.contract.accountId).toBe('gift-candidate.near');
    for (const k of Object.keys(gift)) expect(resolveGiftProfile({ ...gift, [k]: undefined }, NET)).toBeNull();
    expect(resolveGiftProfile({ ...gift, codeHash: 'nope' }, NET)).toBeNull();
    expect(resolveGiftProfile(gift, null)).toBeNull();
    expect(resolveGiftProfile(gift, { ...NET, rpcUrl: 'https://rpc.testnet.near.org' })).toBeNull();
  });
  it('Escrow: account + code hash required; pilot/staging/recovery/router refused', () => {
    expect(resolveEscrowProfile({ contractId: 'escrow-candidate.near', codeHash: HASH }, NET)?.contract.accountId).toBe('escrow-candidate.near');
    expect(resolveEscrowProfile({ contractId: 'escrow-candidate.near' }, NET)).toBeNull();
    for (const id of ['taply-pay.kendinecrypto.near', 'devkendinecrypto.near', 'kendinecrypto.near', 'intents.near'])
      expect(resolveEscrowProfile({ contractId: id, codeHash: HASH }, NET)).toBeNull();
  });
  it('minutesToNs accepts only whole minutes in range', () => {
    expect(minutesToNs('10', CANCEL_MINUTES)).toBe('600000000000');
    expect(minutesToNs('60', CANCEL_MINUTES)).toBe('3600000000000');
    for (const bad of ['0', '61', '1.5', '-1', '', 'abc', '10e2']) expect(minutesToNs(bad, CANCEL_MINUTES)).toBeNull();
    expect(minutesToNs('4', FUNDING_MINUTES)).toBeNull();
    expect(minutesToNs('1440', FUNDING_MINUTES)).toBe('86400000000000');
  });
  it('creation nonces are 32 random bytes of hex', () => {
    const a = randomCreationNonce(), b = randomCreationNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('account-filtered activity', () => {
  const req = (recipient: string, payer: string | null, status: string) => ({ kind: 'ok' as const, fixture: true, readAtMs: 0,
    request: { recipientAccountId: recipient, payerAccountId: payer, status } as never });
  const me = new Set(['alice.near', 'abc123'.padEnd(64, '0')]);
  it('received / paid / open match only this account\'s relations', () => {
    expect(matchesActivityFilter(req('alice.near', 'bob.near', 'FINAL_PAID'), 'received', me)).toBe(true);
    expect(matchesActivityFilter(req('carol.near', 'bob.near', 'FINAL_PAID'), 'received', me)).toBe(false);
    expect(matchesActivityFilter(req('carol.near', 'alice.near', 'FINAL_PAID'), 'paid', me)).toBe(true);
    expect(matchesActivityFilter(req('carol.near', null, 'OPEN'), 'paid', me)).toBe(false);
    expect(matchesActivityFilter(req('carol.near', null, 'OPEN'), 'open', me)).toBe(true);
    expect(matchesActivityFilter(req('carol.near', null, 'FINAL_PAID'), 'open', me)).toBe(false);
  });
  it('unread rows only appear under "all"', () => {
    expect(matchesActivityFilter({ kind: 'error' }, 'all', me)).toBe(true);
    expect(matchesActivityFilter({ kind: 'error' }, 'received', me)).toBe(false);
    expect(matchesActivityFilter(undefined, 'paid', me)).toBe(false);
  });
});

describe('merchant sale codes and routes', () => {
  const id = 'a'.repeat(64);
  it('accepts a 64-hex code or a same-origin /m/pay link only', () => {
    expect(saleRequestId(id, 'https://mainnet.taplyapp.xyz')).toBe(id);
    expect(saleRequestId(`https://mainnet.taplyapp.xyz/m/pay/${id}`, 'https://mainnet.taplyapp.xyz')).toBe(id);
    expect(saleRequestId(`https://evil.example/m/pay/${id}`, 'https://mainnet.taplyapp.xyz')).toBeNull();
    expect(saleRequestId(`https://mainnet.taplyapp.xyz/pay/${id}`, 'https://mainnet.taplyapp.xyz')).toBeNull();
    expect(saleRequestId('A'.repeat(64), 'https://mainnet.taplyapp.xyz')).toBeNull();
  });
  it('product allowlist covers the new routes and nothing looser', () => {
    for (const p of ['gift/' + 'f'.repeat(32), 'gift/' + 'f'.repeat(32) + '/receipt', 'gift/p', 'protected/' + id, 'protected/new', 'merchant/register', 'checkout/shop.near'])
      expect(isProductRoute(p)).toBe(true);
    for (const p of ['gift/' + 'F'.repeat(32), 'gift/' + 'f'.repeat(31), 'protected/' + 'f'.repeat(63), 'checkout/Bad_Account'])
      expect(isProductRoute(p)).toBe(false);
  });
});

describe('Personal Gift tx hash accepts every 32-byte base58 encoding', () => {
  const base: PersonalGiftPayload = { v: 1, network: 'near-mainnet', from: 'alice.near', to: 'bob.near', amountYocto: '1', txHash: HASH, message: '', design: 0 };
  it.each([HASH, '11111111111111111111111111111114', 'EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H'])('%s', (h) => {
    expect(decodePersonalGift(encodePersonalGift({ ...base, txHash: h }))).not.toBeNull();
  });
  it.each(['1111111111111111111111111111111', 'z'.repeat(44), '0'.repeat(43)])('rejects %s', (h) => {
    expect(() => encodePersonalGift({ ...base, txHash: h })).toThrow();
  });
});
