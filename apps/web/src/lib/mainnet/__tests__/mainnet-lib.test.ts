import { describe, expect, it } from 'vitest';
import { MainnetRequestSchema, MAINNET_USDC_ASSET } from '@taply/shared';
import { MAINNET_ASSETS, formatMainnetAmount, parseMainnetAmount } from '../assets';
import { routeDecision } from '../build';
import { resolveMainnetConfig } from '../config';
import { baseTxUrl, nearAccountUrl, nearTxUrl } from '../explorer';
import { FIXTURE_CONTRACT, FIXTURE_SCENARIOS, buildFixtureRequest, fixtureById, fixtureNonce, fixtureRequests } from '../fixtures';
import { BASE_USDC, isStillListed, originAssetById } from '../oneclick/allowlist';
import { eip55Checksum, validateEvmAddress, validateRefundAddress } from '../oneclick/refund-address';
import { MAINNET_INDEPENDENT_VERIFIER_AVAILABLE, MAINNET_SIGNING_RELEASE_APPROVED, ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED } from '../release-gates';
import { IN_FLIGHT_STALE_MS, SUCCESS_SETTLE_WINDOW_MS, derivePaymentView } from '../status';
import type { ContractStatus, OneClickStatus, PaymentInputs } from '../status';

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const HASH = 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf';

describe('release gates (owner NO-GO 2026-11-13)', () => {
  it('all three gates are closed in code', () => {
    expect(MAINNET_SIGNING_RELEASE_APPROVED).toBe(false);
    expect(ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED).toBe(false);
    expect(MAINNET_INDEPENDENT_VERIFIER_AVAILABLE).toBe(false);
  });
});

describe('route isolation between builds', () => {
  it.each([
    ['/m', 'rewrite_not_found'],
    ['/m/pay/abc', 'rewrite_not_found'],
    ['/api/mainnet/oneclick/quote', 'rewrite_not_found'],
    ['/', 'pass'],
    ['/pay/abc', 'pass'],
    ['/wallet/create', 'pass'],
    ['/mango', 'pass'],
  ])('Testnet build: %s -> %s (Next standard 404, as before)', (path, kind) => {
    expect(routeDecision(path, false).kind).toBe(kind);
  });

  it.each([
    ['/m', 'pass'],
    ['/m/request/new', 'pass'],
    ['/api/mainnet/oneclick/status', 'pass'],
    ['/', 'redirect'],
    ['/wallet/create', 'redirect'],
    ['/wallet/restore', 'redirect'],
    ['/pay/abc', 'redirect'],
    ['/api/handshake/rooms', 'not_found'],
  ])('Mainnet build: %s -> %s', (path, kind) => {
    expect(routeDecision(path, true).kind).toBe(kind);
  });
});

describe('mainnet profile', () => {
  const env = {
    network: 'near-mainnet',
    rpcUrl: 'https://rpc.mainnet.fastnear.com',
    rpcProviderId: 'fastnear-mainnet',
    explorerBaseUrl: 'https://nearblocks.io',
  };

  it('requires the mainnet network and explicit mainnet RPC/explorer (no Testnet defaults)', () => {
    expect(resolveMainnetConfig({ ...env, network: 'near-testnet' })).toEqual({ ok: false, reason: 'not_mainnet' });
    expect(resolveMainnetConfig({ ...env, rpcUrl: undefined })).toEqual({ ok: false, reason: 'invalid_rpc' });
    expect(resolveMainnetConfig({ ...env, rpcUrl: 'https://rpc.testnet.near.org' })).toEqual({ ok: false, reason: 'invalid_rpc' });
    expect(resolveMainnetConfig({ ...env, explorerBaseUrl: 'https://testnet.nearblocks.io' })).toEqual({ ok: false, reason: 'invalid_explorer' });
  });

  it('no contract pinned -> not_configured, no profile', () => {
    const c = resolveMainnetConfig(env);
    expect(c.ok && c.contract.status).toBe('not_configured');
    expect(c.ok && c.profile).toBeNull();
  });

  it('pins only the approved accounts with a non-Testnet code hash', () => {
    const ok = resolveMainnetConfig({ ...env, contractId: 'taply-pay.kendinecrypto.near', contractCodeHash: HASH });
    expect(ok.ok && ok.contract).toEqual({ status: 'configured', accountId: 'taply-pay.kendinecrypto.near', expectedCodeHash: HASH });
    expect(ok.ok && ok.profile?.contract.accountId).toBe('taply-pay.kendinecrypto.near');
    const recovery = resolveMainnetConfig({ ...env, contractId: 'kendinecrypto.near', contractCodeHash: HASH });
    expect(recovery.ok && recovery.contract).toEqual({ status: 'invalid', reason: 'account' });
    const testnetHash = resolveMainnetConfig({ ...env, contractId: 'devkendinecrypto.near', contractCodeHash: '963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84' });
    expect(testnetHash.ok && testnetHash.contract).toEqual({ status: 'invalid', reason: 'code_hash' });
    const empty = resolveMainnetConfig({ ...env, contractId: 'devkendinecrypto.near', contractCodeHash: '11111111111111111111111111111111' });
    expect(empty.ok && empty.contract).toEqual({ status: 'invalid', reason: 'code_hash' });
    const half = resolveMainnetConfig({ ...env, contractId: 'devkendinecrypto.near' });
    expect(half.ok && half.contract).toEqual({ status: 'invalid', reason: 'half_set' });
  });

  it('signing stays disabled even with the env flag on (compile-time gate)', () => {
    const c = resolveMainnetConfig({ ...env, signing: 'on' });
    expect(c.ok && c.signingEnabled).toBe(false);
  });
});

describe('amounts and caps', () => {
  it('USDC: 6 decimals, cap 25 USDC, no extra precision, no zero', () => {
    expect(parseMainnetAmount('25', MAINNET_ASSETS.USDC)).toEqual({ ok: true, baseUnits: '25000000' });
    expect(parseMainnetAmount('25.000001', MAINNET_ASSETS.USDC)).toEqual({ ok: false, reason: 'cap' });
    expect(parseMainnetAmount('0.1234567', MAINNET_ASSETS.USDC)).toEqual({ ok: false, reason: 'precision' });
    expect(parseMainnetAmount('0', MAINNET_ASSETS.USDC)).toEqual({ ok: false, reason: 'zero' });
    expect(parseMainnetAmount('abc', MAINNET_ASSETS.USDC)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMainnetAmount('12,5', MAINNET_ASSETS.USDC)).toEqual({ ok: true, baseUnits: '12500000' });
  });

  it('NEAR: 24 decimals, cap exactly 1 NEAR = 10^24 yocto', () => {
    expect(parseMainnetAmount('1', MAINNET_ASSETS.NEAR)).toEqual({ ok: true, baseUnits: '1000000000000000000000000' });
    expect(parseMainnetAmount('1.000000000000000000000001', MAINNET_ASSETS.NEAR)).toEqual({ ok: false, reason: 'cap' });
  });

  it('formats exactly, never rounded', () => {
    expect(formatMainnetAmount('12500000', MAINNET_ASSETS.USDC)).toBe('12.5 USDC');
    expect(formatMainnetAmount('1', MAINNET_ASSETS.USDC)).toBe('0.000001 USDC');
    expect(formatMainnetAmount('250000000000000000000000', MAINNET_ASSETS.NEAR, 'tr')).toBe('0,25 NEAR');
  });
});

describe('explorer links', () => {
  it('mainnet nearblocks and basescan only from validated input', () => {
    expect(nearTxUrl('Afo9C89HutErBxJgqU4N9NrhMqEAV5BZLnxNSFddqzWE')).toBe('https://nearblocks.io/txns/Afo9C89HutErBxJgqU4N9NrhMqEAV5BZLnxNSFddqzWE');
    expect(nearTxUrl('javascript:alert(1)')).toBeNull();
    expect(nearAccountUrl('taply-pay.kendinecrypto.near')).toBe('https://nearblocks.io/address/taply-pay.kendinecrypto.near');
    expect(baseTxUrl(`0x${'AB'.repeat(32)}`)).toBe(`https://basescan.org/tx/0x${'ab'.repeat(32)}`);
    expect(baseTxUrl('0x12')).toBeNull();
  });
});

describe('origin allowlist and refund addresses', () => {
  it('Base USDC only', () => {
    expect(originAssetById(BASE_USDC.assetId)).toBe(BASE_USDC);
    expect(originAssetById('nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near')).toBeNull();
    expect(isStillListed(BASE_USDC, [{ assetId: BASE_USDC.assetId, blockchain: 'base', symbol: 'USDC', decimals: 6, contractAddress: '0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913' }])).toBe(true);
    expect(isStillListed(BASE_USDC, [{ assetId: BASE_USDC.assetId, blockchain: 'eth', symbol: 'USDC', decimals: 6 }])).toBe(false);
  });

  it('EIP-55: checksummed mixed case passes, a broken checksum fails, single case is accepted', () => {
    // Test vectors from EIP-55.
    expect(eip55Checksum('5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(validateEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toEqual({ ok: true, address: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed' });
    expect(validateEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toEqual({ ok: false, reason: 'checksum' });
    expect(validateEvmAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359').ok).toBe(true);
    expect(validateEvmAddress('0xFB6916095CA1DF60BB79CE92CE3EA74C37C5D359').ok).toBe(true);
    expect(validateEvmAddress('fb6916095ca1df60bb79ce92ce3ea74c37c5d359')).toEqual({ ok: false, reason: 'format' });
    expect(validateEvmAddress('bob.near')).toEqual({ ok: false, reason: 'format' });
  });

  it('refuses the zero address and the token contract as refund targets', () => {
    expect(validateRefundAddress(BASE_USDC, '0x0000000000000000000000000000000000000000')).toEqual({ ok: false, reason: 'forbidden' });
    expect(validateRefundAddress(BASE_USDC, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('fixtures (FIXTURE DATA — NOT ON CHAIN)', () => {
  it('every scenario is a schema-valid MainnetRequest on the staging contract', () => {
    for (const { request } of fixtureRequests(NOW)) {
      expect(MainnetRequestSchema.safeParse(request).success).toBe(true);
      expect(request.terms.contractId).toBe(FIXTURE_CONTRACT);
    }
    expect(fixtureRequests(NOW)).toHaveLength(FIXTURE_SCENARIOS.length);
  });

  it('ids are deterministic and hashes stable within the hour', () => {
    const a = buildFixtureRequest(FIXTURE_SCENARIOS[0]!, NOW);
    const b = buildFixtureRequest(FIXTURE_SCENARIOS[0]!, NOW + 59 * 60_000);
    expect(a.terms.id).toBe(b.terms.id);
    expect(a.termsHash).toBe(b.termsHash);
    expect(fixtureById(a.terms.id, NOW)?.scenario.name).toBe('usdc-awaiting');
    expect(fixtureNonce('ab')).toBe(`6162${'0'.repeat(60)}`);
  });

  it('USDC fixtures use the native mainnet USDC asset', () => {
    expect(buildFixtureRequest(FIXTURE_SCENARIOS[0]!, NOW).terms.assetId).toBe(MAINNET_USDC_ASSET);
  });
});

describe('payment state (contract is the only source of "recorded"; Verified unreachable)', () => {
  const at = (status: ContractStatus, inFlightSinceMs: number | null = null) => ({ status, readAtMs: NOW, inFlightSinceMs });
  const hint = (status: OneClickStatus, sinceMs = NOW) => ({ status, sinceMs });
  const v = (i: Partial<PaymentInputs>) => derivePaymentView({ contract: at('OPEN'), oneClick: null, nowMs: NOW, ...i });

  it.each<[Partial<PaymentInputs>, string, string]>([
    [{}, 'AWAITING_PAYMENT', 'none'],
    [{ oneClick: hint('PENDING_DEPOSIT') }, 'AWAITING_PAYMENT', 'none'],
    [{ oneClick: hint('KNOWN_DEPOSIT_TX') }, 'DEPOSIT_OBSERVED', 'none'],
    [{ oneClick: hint('PROCESSING') }, 'PROCESSING', 'none'],
    [{ oneClick: hint('SUCCESS') }, 'PROCESSING', 'oneclick_success_awaiting_contract'],
    [{ oneClick: hint('SUCCESS', NOW - SUCCESS_SETTLE_WINDOW_MS - 1) }, 'UNKNOWN', 'success_not_settled'],
    [{ oneClick: hint('REFUNDED') }, 'REFUNDED', 'none'],
    [{ oneClick: hint('FAILED') }, 'FAILED', 'none'],
    [{ oneClick: hint('INCOMPLETE_DEPOSIT') }, 'FAILED', 'incomplete_deposit'],
    [{ contract: at('FINAL_PAID'), oneClick: hint('SUCCESS') }, 'PAYMENT_RECORDED', 'contract_only'],
    [{ contract: at('FINAL_PAID') }, 'PAYMENT_RECORDED', 'contract_only'],
    [{ contract: at('FINAL_PAID'), oneClick: hint('REFUNDED') }, 'PAYMENT_RECORDED', 'hint_contradicts_contract'],
    [{ contract: at('PAYOUT_IN_FLIGHT', NOW - 60_000) }, 'PROCESSING', 'payout_in_flight'],
    [{ contract: at('PAYOUT_IN_FLIGHT', NOW - IN_FLIGHT_STALE_MS - 1) }, 'UNKNOWN', 'payout_in_flight_stale'],
    [{ contract: at('PAYOUT_FAILED_RECOVERABLE') }, 'FAILED', 'payout_failed_recoverable'],
    [{ contract: at('CANCELLED_UNFUNDED') }, 'FAILED', 'cancelled'],
    [{ contract: at('CANCELLED_UNFUNDED'), oneClick: hint('SUCCESS') }, 'UNKNOWN', 'delivery_after_close'],
    [{ contract: 'error' }, 'UNKNOWN', 'contract_unreadable'],
    [{ contract: null }, 'UNKNOWN', 'request_missing'],
  ])('%j -> %s / %s', (inputs, state, detail) => {
    const r = v(inputs);
    expect(r.state).toBe(state);
    expect(r.detail).toBe(detail);
  });

  it('1Click SUCCESS alone is never "recorded" or "verified", at any age', () => {
    for (const age of [0, 60_000, SUCCESS_SETTLE_WINDOW_MS * 10]) {
      const r = v({ oneClick: hint('SUCCESS', NOW - age) });
      expect(['PAYMENT_RECORDED', 'VERIFIED']).not.toContain(r.state);
    }
  });

  it('no input combination yields VERIFIED while the verifier is unavailable', () => {
    const statuses: ContractStatus[] = ['OPEN', 'CANCELLED_UNFUNDED', 'PAYOUT_IN_FLIGHT', 'PAYOUT_FAILED_RECOVERABLE', 'FINAL_PAID'];
    const hints: Array<OneClickStatus | null> = [null, 'PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED'];
    for (const s of statuses) for (const h of hints) {
      const r = v({ contract: at(s, NOW), oneClick: h === null ? null : hint(h) });
      expect(r.state).not.toBe('VERIFIED');
      expect(r.verifiedAvailable).toBe(false);
    }
  });

  it('once money may be moving, the screen forbids paying again', () => {
    expect(v({ oneClick: hint('KNOWN_DEPOSIT_TX') }).doNotRepay).toBe(true);
    expect(v({ contract: 'error', oneClick: hint('PROCESSING') }).doNotRepay).toBe(true);
    expect(v({ contract: at('PAYOUT_IN_FLIGHT', NOW - IN_FLIGHT_STALE_MS - 1) }).doNotRepay).toBe(true);
    expect(v({}).doNotRepay).toBe(false);
  });
});
