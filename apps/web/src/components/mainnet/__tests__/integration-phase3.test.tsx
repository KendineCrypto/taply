import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MainnetEscrowConfigSchema, prepareMainnetCreateGift } from '@taply/near-client';
import { MainnetEscrowRequestSchema } from '@taply/shared';
import { walletEn, walletTr } from '@/lib/mainnet/wallet-copy';

vi.mock('@/lib/mainnet/config', () => ({ MAINNET_CONFIG: { ok: true, fixtures: true, rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'x', contract: { status: 'not_configured' }, profile: null } }));
const { ESCROW_FIXTURES, PROTECTED_COPY, availableActions } = await import('../Protected');
const { FIXTURE_GIFT_CONFIG, GIFT_COPY } = await import('../GiftMainnet');

const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');
function shape(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return typeof v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
}

describe('escrow fixtures are Codex\'s Rust-emitted states, unchanged', () => {
  it.each(['open', 'locked', 'release-in-flight', 'refund-in-flight', 'release-failed', 'refund-failed', 'final-paid', 'cancelled-refunded', 'config'])('%s identical to packages/near-client fixture', (name) => {
    const a = readFileSync(join(ROOT, 'packages/near-client/test/fixtures/mainnet-protocol', `protected-${name}.json`), 'utf8');
    const b = readFileSync(join(ROOT, 'apps/web/src/lib/mainnet/escrow-fixtures', `protected-${name}.json`), 'utf8');
    expect(b).toBe(a);
  });
});

describe('Protected Pay actions come only from the reviewed builders', () => {
  const config = MainnetEscrowConfigSchema.parse(JSON.parse(readFileSync(join(ROOT, 'apps/web/src/lib/mainnet/escrow-fixtures/protected-config.json'), 'utf8')));
  const c = PROTECTED_COPY.en;
  const at = (name: string, after: boolean) => {
    const r = MainnetEscrowRequestSchema.parse(ESCROW_FIXTURES.find((f) => f.name === name)!.raw);
    const obs = r.cancelUntilNs === null ? r.createdAtNs : (BigInt(r.cancelUntilNs) + (after ? 1_000_000_000n : -30_000_000_000n)).toString();
    return availableActions(c, config, config.contractId, r, obs).map((a) => a.call.methodName);
  };
  it.each([
    ['locked', false, ['cancel_protected']],
    ['locked', true, ['release_protected']],
    ['release-failed', true, ['retry_native_transfer']],
    ['refund-failed', true, ['retry_native_transfer']],
    ['release-in-flight', true, []],
    ['refund-in-flight', false, []],
    ['final-paid', true, []],
    ['cancelled-refunded', true, []],
  ] as const)('%s (after cutoff: %s) -> %j', (name, after, expected) => {
    expect(at(name, after)).toEqual(expected);
  });
});

describe('Gift (fixture config) and copy parity', () => {
  it('fixture config is explicitly unapproved and never a payment/recovery account', () => {
    expect(FIXTURE_GIFT_CONFIG.reviewStatus).toBe('UNREVIEWED_NOT_FOR_REAL_FUNDS');
    expect(['taply-pay.kendinecrypto.near', 'devkendinecrypto.near', 'kendinecrypto.near']).not.toContain(FIXTURE_GIFT_CONFIG.contractId);
  });
  it('create_gift deposit = amount + fee; out-of-limit amounts refused', () => {
    const base = { config: FIXTURE_GIFT_CONFIG, signerAccountId: 'a.near', giftId: 'ab'.repeat(16), publicKeyHex: 'cd'.repeat(32), lifetimeS: 3600, message: '', design: 0 };
    expect(prepareMainnetCreateGift({ ...base, amountYocto: '500000000000000000000000' }).depositYocto).toBe('510000000000000000000000');
    expect(() => prepareMainnetCreateGift({ ...base, amountYocto: '1' })).toThrow();
    expect(() => prepareMainnetCreateGift({ ...base, amountYocto: '2000000000000000000000000' })).toThrow();
  });
  it('EN/TR keys identical for wallet, gift and protected copy', () => {
    expect(shape(walletTr)).toEqual(shape(walletEn));
    expect(shape(GIFT_COPY.tr)).toEqual(shape(GIFT_COPY.en));
    expect(shape(PROTECTED_COPY.tr)).toEqual(shape(PROTECTED_COPY.en));
  });
});
