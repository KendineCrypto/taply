// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2';
import { FIXTURE_CONTRACT, FIXTURE_TOKENS, fixtureRequests } from '@/lib/mainnet/fixtures';
import type { MainnetRequest } from '@/lib/mainnet/fixtures';
import { BASE_USDC, DYNAMIC_ORIGINS, originFromTokens, resolveDynamicOrigins } from '@/lib/mainnet/oneclick/allowlist';
import { base58Decode, validateRefundAddress, validateSolanaAddress, validateTronAddress } from '@/lib/mainnet/oneclick/refund-address';
import { readPrefill, requestPrefill } from '@/lib/mainnet/prefill';
import { createRooms, DEFAULT_ROOM_NAMESPACE } from '@/server/handshake/rooms';
import type { ChainView } from '../chain';
import { MAINNET_ROOM_NAMESPACE, mainnetHandshakeEnabled, openDeadlineFrom } from '../handshake';
import { createFixtureClient, createFixtureSigner } from '../oneclick/fixture-client';
import { createOneClickService } from '../oneclick/service';
import type { ServiceDeps } from '../oneclick/service';
import { memoryQuoteStore } from '../oneclick/store';
import { base58 } from '../oneclick/fixture-client';

/** Phase 2 parity: Solana/Tron origins, Mainnet Live Handshake isolation, prefills. No network, no funds. */

const NOW = Date.UTC(2026, 10, 13, 12, 20, 0);
const entries = fixtureRequests(NOW);
const byName = (n: string) => entries.find((e) => e.scenario.name === n)!.request;
const AWAITING = byName('usdc-awaiting');
const signer = createFixtureSigner();
const SOL = FIXTURE_TOKENS[1]!.assetId;
const TRON = FIXTURE_TOKENS[2]!.assetId;

function tronAddress(body20: Uint8Array): string {
  const payload = new Uint8Array([0x41, ...body20]);
  const check = sha256(sha256(payload)).slice(0, 4);
  return base58(new Uint8Array([...payload, ...check]));
}
const SOLANA_WALLET = base58(new Uint8Array(32).fill(7));
const TRON_WALLET = tronAddress(new Uint8Array(20).fill(9));

function chain(requests: ReadonlyArray<MainnetRequest>): ChainView {
  return {
    contractId: FIXTURE_CONTRACT,
    configProblems: async () => [],
    readRequest: async (id) => ({ request: requests.find((r) => r.terms.id === id) ?? null, finalTimestampNs: (BigInt(NOW) * 1_000_000n).toString() }),
    isUsdcRegistered: async () => true,
  };
}
const deps = (o: Partial<ServiceDeps> = {}): ServiceDeps => ({
  mode: 'fixture',
  chain: chain(entries.map((e) => e.request)),
  client: createFixtureClient(signer, () => NOW),
  store: memoryQuoteStore(() => NOW),
  managerPublicKey: signer.publicKey,
  now: () => NOW,
  fixtureTokens: () => FIXTURE_TOKENS,
  ...o,
});

describe('Solana and Tron refund addresses', () => {
  it('base58 decodes exactly and rejects foreign characters', () => {
    expect(base58Decode('1')).toEqual(new Uint8Array([0]));
    expect(base58Decode('0OIl')).toBeNull();
  });
  it('Solana: 32-byte base58 keys only; zero key and the USDC mint refused as refund', () => {
    expect(validateSolanaAddress(SOLANA_WALLET)).toEqual({ ok: true, address: SOLANA_WALLET });
    expect(validateSolanaAddress('11111111111111111111111111111111')).toEqual({ ok: false, reason: 'forbidden' });
    expect(validateSolanaAddress('0x1111111111111111111111111111111111111111')).toEqual({ ok: false, reason: 'format' });
    expect(validateSolanaAddress(base58(new Uint8Array(31).fill(7)))).toEqual({ ok: false, reason: 'format' });
    const sol = DYNAMIC_ORIGINS.find((d) => d.key === 'solana-usdc')!;
    expect(validateRefundAddress(sol, sol.contractAddress)).toEqual({ ok: false, reason: 'forbidden' });
  });
  it('Tron: base58check with 0x41 prefix; broken checksum, EVM hex and the USDT contract refused', () => {
    expect(validateTronAddress(TRON_WALLET)).toEqual({ ok: true, address: TRON_WALLET });
    const broken = TRON_WALLET.slice(0, -1) + (TRON_WALLET.endsWith('a') ? 'b' : 'a');
    expect(validateTronAddress(broken).ok).toBe(false);
    expect(validateTronAddress('0x1111111111111111111111111111111111111111')).toEqual({ ok: false, reason: 'format' });
    expect(validateTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').ok).toBe(true); // the real USDT contract is a valid address…
    const tron = DYNAMIC_ORIGINS.find((d) => d.key === 'tron-usdt')!;
    expect(validateRefundAddress(tron, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toEqual({ ok: false, reason: 'forbidden' }); // …but never a refund target
    expect(validateRefundAddress(tron, tronAddress(new Uint8Array(20)))).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('runtime-resolved origins (no invented route)', () => {
  it('resolves Solana and Tron only from an exact, unique token-list match', () => {
    expect(resolveDynamicOrigins(FIXTURE_TOKENS).map((o) => [o.key, o.assetId])).toEqual([['solana-usdc', SOL], ['tron-usdt', TRON]]);
    expect(resolveDynamicOrigins([])).toEqual([]);
    const lowered = FIXTURE_TOKENS.map((t) => ({ ...t, contractAddress: t.contractAddress.toLowerCase() }));
    expect(resolveDynamicOrigins(lowered)).toEqual([]); // base58 is case-sensitive
    const duplicated = [...FIXTURE_TOKENS, { ...FIXTURE_TOKENS[1]!, assetId: 'nep141:sol-other.omft.near' }];
    expect(resolveDynamicOrigins(duplicated).map((o) => o.key)).toEqual(['tron-usdt']); // ambiguous -> not offered
    expect(resolveDynamicOrigins([{ ...FIXTURE_TOKENS[2]!, decimals: 18 }])).toEqual([]);
  });
  it('a requested asset ID must be the static Base ID or a live-resolved one', () => {
    expect(originFromTokens(BASE_USDC.assetId, [])).toBe(BASE_USDC);
    expect(originFromTokens(SOL, FIXTURE_TOKENS)?.chain).toBe('sol');
    expect(originFromTokens(SOL, [])).toBeNull();
    expect(originFromTokens('nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', FIXTURE_TOKENS)).toBeNull();
  });
});

describe('quote service with Solana and Tron', () => {
  it('lists Base, Solana and Tron in fixture mode, marked fixture', async () => {
    const r = await createOneClickService(deps()).origins();
    expect(r.ok && r.value.map((o) => [o.chain, o.symbol, o.source])).toEqual([['base', 'USDC', 'fixture'], ['sol', 'USDC', 'fixture'], ['tron', 'USDT', 'fixture']]);
  });
  it('dry mode offers only what the live list describes identically', async () => {
    const live = [FIXTURE_TOKENS[0]!, FIXTURE_TOKENS[1]!];
    const r = await createOneClickService(deps({ mode: 'dry', client: { ...createFixtureClient(signer, () => NOW), tokens: async () => live } })).origins();
    expect(r.ok && r.value.map((o) => [o.chain, o.source])).toEqual([['base', 'recorded-live-quote'], ['sol', 'live-token-list']]);
  });
  it('off mode lists nothing', async () => {
    expect(await createOneClickService(deps({ mode: 'off' })).origins()).toEqual({ ok: false, code: 'ONECLICK_DISABLED' });
  });
  it('prepares a verified Solana quote with a Solana refund address; EVM refund refused', async () => {
    const svc = createOneClickService(deps());
    const ok = await svc.prepareQuote({ requestId: AWAITING.terms.id, originAsset: SOL, refundTo: SOLANA_WALLET });
    expect(ok.ok && ok.value).toMatchObject({ originAssetId: SOL, refundTo: SOLANA_WALLET, amountOut: AWAITING.terms.amountBaseUnits, deposit: null });
    const svc2 = createOneClickService(deps());
    expect(await svc2.prepareQuote({ requestId: AWAITING.terms.id, originAsset: SOL, refundTo: '0x1111111111111111111111111111111111111111' })).toEqual({ ok: false, code: 'REFUND_ADDRESS_INVALID' });
  });
  it('prepares a Tron USDT quote; an asset ID not on the token list is refused', async () => {
    const ok = await createOneClickService(deps()).prepareQuote({ requestId: AWAITING.terms.id, originAsset: TRON, refundTo: TRON_WALLET });
    expect(ok.ok).toBe(true);
    expect(await createOneClickService(deps({ fixtureTokens: () => [] })).prepareQuote({ requestId: AWAITING.terms.id, originAsset: TRON, refundTo: TRON_WALLET })).toEqual({ ok: false, code: 'ORIGIN_NOT_ALLOWED' });
  });
});

describe('Mainnet Live Handshake isolation', () => {
  function recording() {
    const calls: string[][] = [];
    const redis = vi.fn(async (args: ReadonlyArray<string | number>) => {
      calls.push(args.map(String));
      return args[0] === 'SET' ? 'OK' : args[0] === 'INCR' ? 1 : null;
    });
    return { redis, calls };
  }
  it('Testnet keeps its namespace; Mainnet writes only under taply:mainnet:hs', async () => {
    expect(DEFAULT_ROOM_NAMESPACE).toBe('taply:hs');
    const t = recording();
    await createRooms({ redis: t.redis, now: () => NOW }).create('a'.repeat(64), NOW + 600_000);
    expect(t.calls.filter((c) => c[0] === 'SET').every((c) => c[1]!.startsWith('taply:hs:{'))).toBe(true);
    const m = recording();
    const rooms = createRooms({ redis: m.redis, now: () => NOW, namespace: MAINNET_ROOM_NAMESPACE });
    await rooms.create('a'.repeat(64), NOW + 600_000);
    await rooms.allow('create', '1.2.3.4', 30);
    const keys = m.calls.filter((c) => ['SET', 'INCR', 'PEXPIRE'].includes(c[0]!)).map((c) => c[1]!);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('taply:mainnet:hs:'))).toBe(true);
    expect(() => createRooms({ redis: m.redis, namespace: 'Bad Namespace' })).toThrow('INVALID_ROOM_NAMESPACE');
  });
  it('rooms open only for OPEN, unexpired instant requests on the mainnet chain view', async () => {
    const view = chain(entries.map((e) => e.request));
    const deadline = openDeadlineFrom(view, () => NOW);
    expect(await deadline(AWAITING.terms.id)).toBeGreaterThan(NOW);
    expect(await deadline(byName('usdc-recorded').terms.id)).toBeNull();
    expect(await deadline(byName('usdc-cancelled').terms.id)).toBeNull();
    expect(await deadline('f'.repeat(64))).toBeNull();
    expect(await openDeadlineFrom(view, () => NOW + 48 * 3_600_000)(AWAITING.terms.id)).toBeNull();
    expect(await openDeadlineFrom(null)(AWAITING.terms.id)).toBeNull();
  });
  it('enabled only on a mainnet build with the Handshake flag on', () => {
    expect(mainnetHandshakeEnabled({ NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: 'on' }, true)).toBe(true);
    expect(mainnetHandshakeEnabled({ NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: 'off' }, true)).toBe(false);
    expect(mainnetHandshakeEnabled({ NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: 'on' }, false)).toBe(false);
  });
});

describe('request prefills (Split / Recurring)', () => {
  it('round-trips exact amounts and re-validates', () => {
    const url = requestPrefill('USDC', '3333334', 'Split 1/3');
    expect(url).toBe('/m/request/new?asset=USDC&amount=3.333334&memo=Split+1%2F3');
    expect(readPrefill(url.slice(url.indexOf('?')))).toEqual({ asset: 'USDC', amount: '3.333334', memo: 'Split 1/3' });
    expect(readPrefill('?asset=NEAR&amount=0.000000000000000000000001&memo=x')).toEqual({ asset: 'NEAR', amount: '0.000000000000000000000001', memo: 'x' });
  });
  it('drops over-cap, malformed and unknown values instead of coercing', () => {
    expect(readPrefill('?asset=USDC&amount=26&memo=x')).toEqual({ asset: 'USDC', amount: '', memo: 'x' });
    expect(readPrefill('?asset=USDC&amount=1.0000001')).toEqual({ asset: 'USDC', amount: '', memo: '' });
    expect(readPrefill('?asset=BTC&amount=1')).toBeNull();
    expect(readPrefill('')).toBeNull();
  });
});

describe('Mainnet PWA manifest', () => {
  it('has its own identity and start URL, Testnet wording absent', async () => {
    const { MAINNET_MANIFEST } = await import('@/app/m/manifest.webmanifest/route');
    expect(MAINNET_MANIFEST).toMatchObject({ name: 'Taply — NEAR Mainnet', id: '/m', start_url: '/m' });
    expect(JSON.stringify(MAINNET_MANIFEST)).not.toMatch(/testnet|test funds/i);
  });
  it('the manifest path is allowed on mainnet and rewritten to 404 on Testnet', async () => {
    const { routeDecision } = await import('@/lib/mainnet/build');
    expect(routeDecision('/m/manifest.webmanifest', true).kind).toBe('pass');
    expect(routeDecision('/m/manifest.webmanifest', false).kind).toBe('rewrite_not_found');
  });
});
