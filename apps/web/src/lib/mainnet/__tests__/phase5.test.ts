import { describe, expect, it } from 'vitest';
import { calculateMainnetRequestId } from '@taply/shared';
import type { MainnetIntentTerms } from '@taply/shared';
import {
  deviceId, newBusinessId, prepareOperation, resolveAuthority, resolveUsdcCodeHash, simulatedAuthorityStore, stableBusinessId,
} from '../wallet-ops';
import { bindSale, COMMERCE_PREFIX, displayMemo, encodeSale, newCommerceSession, saleFromHash, saleMatches } from '../commerce';
import { commerceFixture, FIXTURE_CONTRACT, FIXTURE_MERCHANT } from '../fixtures';
import { joinTokenFromHash } from '../live';
import { parseSettlementLines } from '@/components/mainnet/Settlement';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, map: m };
}
const HASH = 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf';

describe('wallet-ops: authority, device, business ids (fail closed)', () => {
  it('authority is UNAVAILABLE unless the test flag AND fixtures are both on', () => {
    const s = memStorage();
    expect(resolveAuthority(undefined, true, s).kind).toBe('unavailable');
    expect(resolveAuthority('on', false, s).kind).toBe('unavailable');
    expect(resolveAuthority('on', true, null).kind).toBe('unavailable');
    expect(resolveAuthority('yes', true, s).kind).toBe('unavailable');
    expect(resolveAuthority('on', true, s).kind).toBe('simulated');
  });
  it('simulated store is a strict compare-and-swap', async () => {
    const st = simulatedAuthorityStore(memStorage());
    expect(st.scope).toBe('account-global');
    expect(await st.read('alice.near')).toBeNull();
    expect(await st.compareAndSwap('alice.near', null, 'v1')).toBe(true);
    expect(await st.compareAndSwap('alice.near', null, 'v2')).toBe(false);
    expect(await st.compareAndSwap('alice.near', 'v1', 'v2')).toBe(true);
    expect(await st.read('alice.near')).toBe('v2');
  });
  it('device id is created once, stable, and a corrupt record is never silently replaced', () => {
    const s = memStorage();
    const a = deviceId(s);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    expect(deviceId(s)).toBe(a);
    s.setItem('taply.mainnet.device.v1', 'nope');
    expect(() => deviceId(s)).toThrow('DEVICE_ID_INVALID');
  });
  it('business id is stable for the same payment and changes only on explicit new payment', () => {
    const s = memStorage();
    const a = stableBusinessId(s, 'alice.near', 'send');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(stableBusinessId(s, 'alice.near', 'send')).toBe(a);
    expect(stableBusinessId(s, 'bob.near', 'send')).not.toBe(a);
    const b = newBusinessId(s, 'alice.near', 'send');
    expect(b).not.toBe(a);
    expect(stableBusinessId(s, 'alice.near', 'send')).toBe(b);
    s.setItem('taply.mainnet.business.v1:alice.near:send', 'x');
    expect(() => stableBusinessId(s, 'alice.near', 'send')).toThrow('BUSINESS_ID_INVALID');
  });
  it('USDC code pin accepts only a base58 hash', () => {
    expect(resolveUsdcCodeHash(HASH)).toBe(HASH);
    expect(resolveUsdcCodeHash(undefined)).toBeUndefined();
    expect(resolveUsdcCodeHash('0xabc')).toBeUndefined();
  });
  it('prepareOperation fails closed when the durable journal cannot be read (no IndexedDB)', async () => {
    const vault = { getIdentity: () => ({ network: 'near-mainnet', accountId: 'a'.repeat(64), publicKeyHex: 'b'.repeat(64) }) } as never;
    await expect(prepareOperation({
      operation: { kind: 'nativeSend', receiverId: 'bob.near', amountNear: '1', businessId: 'c'.repeat(64) },
      signer: { kind: 'internal', vault }, profiles: { network: { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'x' } },
      authority: { kind: 'unavailable' }, deviceId: crypto.randomUUID(),
      fetcher: async () => { throw new Error('must not reach the network'); },
    })).rejects.toThrow('JOURNAL_UNAVAILABLE');
  });
});

function draft(memo = 'Table 4'): MainnetIntentTerms {
  const creationNonce = '1'.repeat(64);
  return { schemaVersion: 'taply.intent.v1', id: calculateMainnetRequestId({ network: 'near-mainnet', contractId: FIXTURE_CONTRACT, creatorAccountId: FIXTURE_MERCHANT, creationNonce }),
    network: 'near-mainnet', contractId: FIXTURE_CONTRACT, creationNonce, creatorAccountId: FIXTURE_MERCHANT, assetId: 'near:native',
    amountBaseUnits: '500000000000000000000000', mode: 'instant', cancelDurationNs: null, fundingExpiresAtNs: '1793523600000000000',
    permittedPayerAccountId: null, merchantAccountId: null, memo, sessionBinding: null };
}

describe('commerce: per-sale commitment (Codex binding)', () => {
  const session = () => newCommerceSession(FIXTURE_CONTRACT, FIXTURE_MERCHANT, '1793523600000000000');
  it('binds terms, derives a fresh id per session, and verifies only the exact reviewed sale', () => {
    const s1 = session(), s2 = session();
    const a = bindSale(draft(), s1), b = bindSale(draft(), s2);
    expect(a.terms.id).not.toBe(b.terms.id);
    expect(a.terms.memo.startsWith(COMMERCE_PREFIX)).toBe(true);
    expect(displayMemo(a.terms.memo)).toBe('Table 4');
    expect(saleMatches(a.terms, a.sale)).toBe(true);
    expect(saleMatches(b.terms, a.sale)).toBe(false);
    expect(saleMatches({ ...a.terms, amountBaseUnits: '1' }, a.sale)).toBe(false);
    expect(saleMatches(a.terms, { ...a.sale, termsHash: 'e'.repeat(64) })).toBe(false);
  });
  it('refuses a merchant other than the creator, an expiry beyond the session, and a memo that cannot fit', () => {
    expect(() => bindSale(draft(), newCommerceSession(FIXTURE_CONTRACT, 'other.near', '1793523600000000000'))).toThrow();
    expect(() => bindSale(draft(), newCommerceSession(FIXTURE_CONTRACT, FIXTURE_MERCHANT, '1'))).toThrow();
    expect(() => bindSale(draft('x'.repeat(250)), session())).toThrow();
  });
  it('fragment payload round-trips and parses only strict forms', () => {
    const { sale } = bindSale(draft(), session());
    const enc = encodeSale(sale);
    expect(saleFromHash(`#c=${enc}`)).toEqual(sale);
    expect(saleFromHash(`#j=${'A'.repeat(22)}&c=${enc}`)).toEqual(sale);
    expect(joinTokenFromHash(`#j=${'A'.repeat(22)}&c=${enc}`)).toBe('A'.repeat(22));
    expect(saleFromHash(`#c=${enc}x!`)).toBeNull();
    expect(saleFromHash('#c=e30')).toBeNull();
    expect(saleFromHash('#x=1')).toBeNull();
  });
  it('the FIXTURE commerce sale is genuinely bound', () => {
    const f = commerceFixture(Date.UTC(2026, 10, 13, 12));
    expect(saleMatches(f.request.terms, { session: f.session, termsHash: f.termsHash })).toBe(true);
    expect(f.request.termsHash).toBe(f.termsHash);
  });
});

describe('settlement input lines', () => {
  it('parses "hash signer" lines and refuses anything else', () => {
    expect(parseSettlementLines(`${HASH} alice.near\n\n${HASH} bob.near`)).toEqual([
      { transactionHash: HASH, signerAccountId: 'alice.near' }, { transactionHash: HASH, signerAccountId: 'bob.near' }]);
    for (const bad of ['', HASH, `${HASH} Alice!`, `${HASH} alice.near extra`, `0x12 alice.near`]) expect(parseSettlementLines(bad)).toBeNull();
  });
});
