// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MAINNET_USDC_ASSET, buildInstantRecipientMessage } from '@taply/shared';
import { FIXTURE_CONTRACT, fixtureRequests } from '@/lib/mainnet/fixtures';
import { nsToDate } from '@/lib/format/time';
import type { MainnetRequest } from '@/lib/mainnet/fixtures';
import { BASE_USDC } from '@/lib/mainnet/oneclick/allowlist';
import { ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED } from '@/lib/mainnet/release-gates';
import type { ChainView } from '../../chain';
import { classifyUpstreamError, createOneClickClient, OneClickHttpError } from '../client';
import type { OneClickClient } from '../client';
import { createFixtureClient, createFixtureSigner, fixtureAmountIn, fixtureQuoteResponse } from '../fixture-client';
import { handleQuote, handleStatus } from '../http';
import { buildQuoteRequest } from '../quote-request';
import { ONE_CLICK_MANAGER_PUB_KEY, verifyQuoteSignatureSdk } from '../sdk';
import { createOneClickService, httpStatusOf, LIMITS, parseOneClickMode } from '../service';
import type { ServiceDeps } from '../service';
import { memoryQuoteStore, redisQuoteStore } from '../store';
import { resolveMode } from '../runtime';
import { MANAGER_PUBLIC_KEY, verifyQuoteResponse } from '../verify';

/**
 * 1Click server integration. All responses are SYNTHETIC fixtures signed with
 * an ephemeral key through the SDK's own quoteHash/verifyQuoteSignature; no
 * network, no funds, no production key.
 */

const NOW = Date.UTC(2026, 10, 13, 12, 20, 0);
const REFUND = '0x1111111111111111111111111111111111111111';
const signer = createFixtureSigner();
const entries = fixtureRequests(NOW);
const byName = (name: string) => entries.find((e) => e.scenario.name === name)!.request;
const AWAITING = byName('usdc-awaiting');

function chainWith(requests: ReadonlyArray<MainnetRequest>, overrides: Partial<ChainView> = {}): ChainView {
  return {
    contractId: FIXTURE_CONTRACT,
    configProblems: async () => [],
    readRequest: async (id) => ({ request: requests.find((r) => r.terms.id === id) ?? null, finalTimestampNs: (BigInt(NOW) * 1_000_000n).toString() }),
    isUsdcRegistered: async () => true,
    ...overrides,
  };
}

function deps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    mode: 'fixture',
    chain: chainWith(entries.map((e) => e.request)),
    client: createFixtureClient(signer, () => NOW),
    store: memoryQuoteStore(() => NOW),
    managerPublicKey: signer.publicKey,
    now: () => NOW,
    ...overrides,
  };
}

const input = (request: MainnetRequest = AWAITING, extra: Record<string, unknown> = {}) => ({
  requestId: request.terms.id,
  originAsset: BASE_USDC.assetId,
  refundTo: REFUND,
  ...extra,
});

function sentFor(request: MainnetRequest, dry = true) {
  return buildQuoteRequest({
    dry,
    origin: BASE_USDC,
    refundTo: REFUND,
    contractId: FIXTURE_CONTRACT,
    requestId: request.terms.id,
    termsHash: request.termsHash,
    amountBaseUnits: request.terms.amountBaseUnits,
    deadlineMs: NOW + LIMITS.quoteTtlMs,
  });
}
const expiresAt = (r: MainnetRequest) => nsToDate(r.terms.fundingExpiresAtNs).getTime();
const ctx = { nowMs: NOW, requestExpiresAtMs: expiresAt(AWAITING), managerPublicKey: signer.publicKey };

describe('quote body', () => {
  it('is EXACT_OUTPUT to the pinned contract with the shared recipient message', () => {
    const body = sentFor(AWAITING);
    expect(body).toMatchObject({
      swapType: 'EXACT_OUTPUT',
      slippageTolerance: 100,
      originAsset: BASE_USDC.assetId,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: MAINNET_USDC_ASSET,
      amount: AWAITING.terms.amountBaseUnits,
      refundType: 'ORIGIN_CHAIN',
      recipient: FIXTURE_CONTRACT,
      recipientType: 'DESTINATION_CHAIN',
    });
    expect(body.customRecipientMsg).toBe(buildInstantRecipientMessage(AWAITING.terms.id, AWAITING.termsHash));
    expect(JSON.parse(body.customRecipientMsg)).toEqual({ id: AWAITING.terms.id, expectedTermsHash: AWAITING.termsHash, action: 'pay_instant' });
  });
});

describe('signed quote verification (official SDK 0.1.26 verifier)', () => {
  const signed = () => signer.signResponse(fixtureQuoteResponse(sentFor(AWAITING) as unknown as Record<string, unknown>, NOW));

  it('accepts an untampered response and returns the exact principal', () => {
    const r = verifyQuoteResponse(signed(), sentFor(AWAITING), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.quote.amountOut).toBe(AWAITING.terms.amountBaseUnits);
      expect(r.quote.amountIn).toBe(fixtureAmountIn(AWAITING.terms.amountBaseUnits));
      expect(r.quote.depositAddress).toBeNull();
    }
  });

  it('production verification uses the 1Click manager key, so a fixture signature fails it', () => {
    expect(MANAGER_PUBLIC_KEY).toBe('ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc');
    expect(MANAGER_PUBLIC_KEY).toBe(ONE_CLICK_MANAGER_PUB_KEY);
    expect(verifyQuoteSignatureSdk(signed())).toBe(false); // SDK default key
    expect(verifyQuoteResponse(signed(), sentFor(AWAITING), { ...ctx, managerPublicKey: MANAGER_PUBLIC_KEY })).toEqual({ ok: false, code: 'SIGNATURE_INVALID' });
  });

  it.each([
    ['recipient', 'evil.near'],
    ['amount', '1'],
    ['customRecipientMsg', buildInstantRecipientMessage('a'.repeat(64), 'b'.repeat(64))],
    ['destinationAsset', 'nep141:usdt.tether-token.near'],
    ['refundTo', '0x2222222222222222222222222222222222222222'],
  ])('a tampered signed field (%s) breaks the signature', (field, value) => {
    const response = signed();
    (response.quoteRequest as unknown as Record<string, unknown>)[field] = value;
    expect(verifyQuoteResponse(response, sentFor(AWAITING), ctx)).toEqual({ ok: false, code: 'SIGNATURE_INVALID' });
  });

  it('a tampered quote amount breaks the signature', () => {
    const response = signed();
    response.quote.amountOut = '1';
    expect(verifyQuoteResponse(response, sentFor(AWAITING), ctx)).toEqual({ ok: false, code: 'SIGNATURE_INVALID' });
  });

  it.each([
    ['recipient', 'evil.near'],
    ['swapType', 'EXACT_INPUT'],
    ['recipientType', 'INTENTS'],
    ['customRecipientMsg', '{"id":"x"}'],
    ['originAsset', 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near'],
  ])('a validly signed response whose echo differs (%s) is refused', (field, value) => {
    const body = { ...sentFor(AWAITING), [field]: value } as unknown as Record<string, unknown>;
    const response = signer.signResponse(fixtureQuoteResponse(body, NOW));
    expect(verifyQuoteResponse(response, sentFor(AWAITING), ctx)).toEqual({ ok: false, code: 'ECHO_MISMATCH' });
  });

  it('refuses amountOut different from the principal, and minAmountOut below it', () => {
    const a = fixtureQuoteResponse(sentFor(AWAITING) as unknown as Record<string, unknown>, NOW);
    expect(verifyQuoteResponse(signer.signResponse({ ...a, quote: { ...a.quote, amountOut: '12499999' } }), sentFor(AWAITING), ctx)).toEqual({ ok: false, code: 'AMOUNT_MISMATCH' });
    expect(verifyQuoteResponse(signer.signResponse({ ...a, quote: { ...a.quote, minAmountOut: '12000000' } }), sentFor(AWAITING), ctx)).toEqual({ ok: false, code: 'MIN_OUTPUT_BELOW_PRINCIPAL' });
  });

  it('refuses stale responses and deadlines past the request expiry margin', () => {
    expect(verifyQuoteResponse(signed(), sentFor(AWAITING), { ...ctx, nowMs: NOW + 5 * 60_000 })).toEqual({ ok: false, code: 'STALE' });
    expect(verifyQuoteResponse(signed(), sentFor(AWAITING), { ...ctx, requestExpiresAtMs: NOW + LIMITS.quoteTtlMs })).toEqual({ ok: false, code: 'DEADLINE_INVALID' });
  });

  it('a dry quote must not carry a deposit address; a funded one must, distinct from the refund address', () => {
    const dryWithDeposit = fixtureQuoteResponse(sentFor(AWAITING) as unknown as Record<string, unknown>, NOW);
    const r1 = signer.signResponse({ ...dryWithDeposit, quote: { ...dryWithDeposit.quote, depositAddress: '0xabc' } });
    expect(verifyQuoteResponse(r1, sentFor(AWAITING), ctx)).toEqual({ ok: false, code: 'DEPOSIT_ADDRESS_INVALID' });
    const funded = fixtureQuoteResponse(sentFor(AWAITING, false) as unknown as Record<string, unknown>, NOW);
    const r2 = signer.signResponse({ ...funded, quote: { ...funded.quote, deadline: new Date(NOW + 600_000).toISOString(), depositAddress: REFUND } });
    expect(verifyQuoteResponse(r2, sentFor(AWAITING, false), ctx)).toEqual({ ok: false, code: 'DEPOSIT_ADDRESS_INVALID' });
  });

  it('malformed responses are refused before any verification', () => {
    expect(verifyQuoteResponse({ quote: {} }, sentFor(AWAITING), ctx)).toEqual({ ok: false, code: 'MALFORMED' });
    expect(verifyQuoteResponse(null, sentFor(AWAITING), ctx)).toEqual({ ok: false, code: 'MALFORMED' });
  });
});

describe('quote service', () => {
  it('prepares a verified quote and never returns a deposit address', async () => {
    const r = await createOneClickService(deps()).prepareQuote(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      mode: 'fixture',
      fundingEnabled: false,
      deposit: null,
      amountOut: AWAITING.terms.amountBaseUnits,
      recipient: FIXTURE_CONTRACT,
      destinationAsset: MAINNET_USDC_ASSET,
      signatureVerified: true,
      reused: false,
    });
    expect(JSON.stringify(r.value)).not.toMatch(/depositAddress|signature"/);
  });

  it('off mode and the funded-quote release gate refuse everything', async () => {
    expect(ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED).toBe(false);
    expect(await createOneClickService(deps({ mode: 'off' })).prepareQuote(input())).toEqual({ ok: false, code: 'ONECLICK_DISABLED' });
    const client = { quote: vi.fn(), status: vi.fn(), tokens: vi.fn() };
    expect(await createOneClickService(deps({ mode: 'funded', client })).prepareQuote(input())).toEqual({ ok: false, code: 'FUNDED_QUOTES_NOT_APPROVED' });
    expect(client.quote).not.toHaveBeenCalled();
  });

  it('refuses without a pinned contract or a store', async () => {
    expect(await createOneClickService(deps({ chain: null })).prepareQuote(input())).toEqual({ ok: false, code: 'CONTRACT_NOT_CONFIGURED' });
    expect(await createOneClickService(deps({ store: null })).prepareQuote(input())).toEqual({ ok: false, code: 'STORE_UNAVAILABLE' });
  });

  it.each([
    [{ originAsset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near' }, 'ORIGIN_NOT_ALLOWED'],
    [{ originAsset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near' }, 'ORIGIN_NOT_ALLOWED'],
    [{ refundTo: 'bob.near' }, 'REFUND_ADDRESS_INVALID'],
    [{ refundTo: '0x0000000000000000000000000000000000000000' }, 'REFUND_ADDRESS_INVALID'],
    [{ refundTo: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }, 'REFUND_ADDRESS_INVALID'],
    [{ requestId: 'not-hex' }, 'INVALID_INPUT'],
    [{ extra: 1 }, 'INVALID_INPUT'],
  ])('input %j -> %s', async (extra, code) => {
    expect(await createOneClickService(deps()).prepareQuote(input(AWAITING, extra))).toEqual({ ok: false, code });
  });

  it.each([
    ['usdc-recorded', 'REQUEST_NOT_OPEN'],
    ['usdc-cancelled', 'REQUEST_NOT_OPEN'],
    ['usdc-r2-unknown', 'REQUEST_NOT_OPEN'],
    ['native-awaiting', 'REQUEST_NOT_USDC'],
    ['usdc-too-small', 'AMOUNT_BELOW_MINIMUM'],
  ])('request %s -> %s', async (name, code) => {
    expect(await createOneClickService(deps()).prepareQuote(input(byName(name)))).toEqual({ ok: false, code });
  });

  it('refuses unknown requests, rejected contract config and unreadable chain', async () => {
    expect(await createOneClickService(deps()).prepareQuote(input(AWAITING, { requestId: 'c'.repeat(64) }))).toEqual({ ok: false, code: 'REQUEST_NOT_FOUND' });
    const rejected = chainWith([AWAITING], { configProblems: async () => ['UNSAFE_GAS_ftOnTransfer'] });
    expect(await createOneClickService(deps({ chain: rejected })).prepareQuote(input())).toEqual({ ok: false, code: 'CONTRACT_CONFIG_REJECTED' });
    const down = chainWith([AWAITING], { readRequest: async () => { throw new Error('RPC'); } });
    expect(await createOneClickService(deps({ chain: down })).prepareQuote(input())).toEqual({ ok: false, code: 'CHAIN_UNAVAILABLE' });
  });

  it('refuses a request whose payer is restricted to someone other than the router', async () => {
    const restricted = { ...AWAITING, terms: { ...AWAITING.terms, permittedPayerAccountId: 'alice.near' } } as MainnetRequest;
    expect(await createOneClickService(deps({ chain: chainWith([restricted]) })).prepareQuote(input(restricted))).toEqual({ ok: false, code: 'REQUEST_PAYER_RESTRICTED' });
  });

  it('refuses a request that expires before the quote window plus margin', async () => {
    const late = deps({ now: () => expiresAt(AWAITING) - 10 * 60_000 });
    expect(await createOneClickService(late).prepareQuote(input())).toEqual({ ok: false, code: 'REQUEST_EXPIRES_TOO_SOON' });
  });

  it('refuses when the contract or the merchant is not registered on USDC', async () => {
    const contractOff = chainWith([AWAITING], { isUsdcRegistered: async (a) => a !== FIXTURE_CONTRACT });
    expect(await createOneClickService(deps({ chain: contractOff })).prepareQuote(input())).toEqual({ ok: false, code: 'CONTRACT_NOT_REGISTERED' });
    const merchantOff = chainWith([AWAITING], { isUsdcRegistered: async (a) => a === FIXTURE_CONTRACT });
    expect(await createOneClickService(deps({ chain: merchantOff })).prepareQuote(input())).toEqual({ ok: false, code: 'MERCHANT_NOT_REGISTERED' });
  });

  it('one active quote per request: same inputs reuse it, different inputs are refused, no second upstream call', async () => {
    const client: OneClickClient = { ...createFixtureClient(signer, () => NOW) };
    const spy = vi.spyOn(client, 'quote');
    const service = createOneClickService(deps({ client }));
    const first = await service.prepareQuote(input());
    const again = await service.prepareQuote(input());
    expect(first.ok && again.ok && again.value.reused && again.value.correlationId === first.value.correlationId).toBe(true);
    expect(await service.prepareQuote(input(AWAITING, { refundTo: '0x3333333333333333333333333333333333333333' }))).toEqual({ ok: false, code: 'ACTIVE_QUOTE_EXISTS' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('concurrent preparation for one request: the second call is BUSY', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = createFixtureClient(signer, () => NOW);
    const slow: OneClickClient = { ...base, quote: async (b) => { await gate; return base.quote(b); } };
    const service = createOneClickService(deps({ client: slow }));
    const a = service.prepareQuote(input());
    const b = await service.prepareQuote(input());
    release();
    expect(b).toEqual({ ok: false, code: 'BUSY' });
    expect((await a).ok).toBe(true);
  });

  it('after expiry a new quote is allowed, up to the per-request limit', async () => {
    let now = NOW;
    const store = memoryQuoteStore(() => now);
    const service = createOneClickService(deps({ store, now: () => now, client: createFixtureClient(signer, () => now) }));
    for (let i = 0; i < LIMITS.maxQuotesPerRequest; i++) {
      expect((await service.prepareQuote(input())).ok).toBe(true);
      now += LIMITS.quoteTtlMs + 1;
    }
    expect(await service.prepareQuote(input())).toEqual({ ok: false, code: 'QUOTE_LIMIT_REACHED' });
  });

  it('an expired funded quote whose deposit may be moving blocks a new quote (no double delivery)', async () => {
    const now = NOW;
    const store = memoryQuoteStore(() => now);
    await store.save({
      requestId: AWAITING.terms.id, correlationId: 'c1', mode: 'funded', originAssetId: BASE_USDC.assetId, refundTo: REFUND,
      depositAddress: '0x9999999999999999999999999999999999999999', depositMemo: null, deadlineMs: NOW - 1, createdAtMs: NOW - 1_000_000,
      amountIn: '1', amountInFormatted: '1', minAmountIn: '1', amountOut: AWAITING.terms.amountBaseUnits, timeEstimateSec: 35, signedResponse: '{}',
    }, 10_000_000);
    const status = vi.fn(async () => ({ status: 'PROCESSING', correlationId: 'c1' }));
    const service = createOneClickService(deps({ store, client: { ...createFixtureClient(signer, () => now), status } }));
    expect(await service.prepareQuote(input())).toEqual({ ok: false, code: 'PREVIOUS_QUOTE_IN_PROGRESS' });
    status.mockResolvedValueOnce({ status: 'REFUNDED', correlationId: 'c1' });
    expect((await service.prepareQuote(input())).ok).toBe(true);
  });

  it('a quote that fails verification is refused with its reason and not stored', async () => {
    const store = memoryQuoteStore(() => NOW);
    const forged: OneClickClient = { ...createFixtureClient(createFixtureSigner(), () => NOW) };
    const r = await createOneClickService(deps({ client: forged, store })).prepareQuote(input());
    expect(r).toEqual({ ok: false, code: 'QUOTE_REJECTED', reason: 'SIGNATURE_INVALID' });
    expect(await store.latest(AWAITING.terms.id)).toBeNull();
  });

  it('upstream errors map to plain codes', async () => {
    const failing = (code: ConstructorParameters<typeof OneClickHttpError>[0]): OneClickClient => ({
      quote: async () => { throw new OneClickHttpError(code); }, status: async () => null, tokens: async () => [],
    });
    expect(await createOneClickService(deps({ client: failing('MIN_AMOUNT') })).prepareQuote(input())).toEqual({ ok: false, code: 'UPSTREAM_MIN_AMOUNT' });
    expect(await createOneClickService(deps({ client: failing('NO_LIQUIDITY') })).prepareQuote(input())).toEqual({ ok: false, code: 'UPSTREAM_NO_LIQUIDITY' });
    expect(httpStatusOf('UPSTREAM_MIN_AMOUNT')).toBe(422);
    expect(httpStatusOf('ACTIVE_QUOTE_EXISTS')).toBe(409);
  });

  it('dry mode requires the origin asset to still be listed identically by /v0/tokens', async () => {
    const listed = [{ assetId: BASE_USDC.assetId, blockchain: 'base', symbol: 'USDC', decimals: 6, contractAddress: BASE_USDC.contractAddress }];
    const base = createFixtureClient(signer, () => NOW);
    const ok = await createOneClickService(deps({ mode: 'dry', client: { ...base, tokens: async () => listed } })).prepareQuote(input());
    expect(ok.ok).toBe(true);
    const changed = [{ ...listed[0], contractAddress: '0xdeadbeef00000000000000000000000000000000' }];
    expect(await createOneClickService(deps({ mode: 'dry', client: { ...base, tokens: async () => changed } })).prepareQuote(input())).toEqual({ ok: false, code: 'ORIGIN_NOT_LISTED' });
  });
});

describe('status service', () => {
  it('fixture mode returns the scripted hint per request', async () => {
    const service = createOneClickService(deps({ fixtureHint: (id) => (id === byName('usdc-refunded').terms.id ? 'REFUNDED' : null) }));
    const r = await service.status(byName('usdc-refunded').terms.id);
    expect(r.ok && r.value.hint).toBe('REFUNDED');
  });

  it('a dry quote has no deposit address, so no status hint', async () => {
    const service = createOneClickService(deps({ mode: 'dry', client: { ...createFixtureClient(signer, () => NOW), tokens: async () => [{ assetId: BASE_USDC.assetId, blockchain: 'base', symbol: 'USDC', decimals: 6, contractAddress: BASE_USDC.contractAddress }] } }));
    await service.prepareQuote(input());
    const r = await service.status(AWAITING.terms.id);
    expect(r.ok && r.value).toMatchObject({ hint: null, hintReason: 'DRY_QUOTE_NO_DEPOSIT' });
  });

  it('looks up by request id only and refuses unknown ids', async () => {
    const service = createOneClickService(deps({ mode: 'dry' }));
    expect(await service.status('0x123')).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await service.status('d'.repeat(64))).toEqual({ ok: false, code: 'NO_QUOTE' });
  });

  it('a funded record: status must echo our deposit address and correlation id; links are built by Taply', async () => {
    const store = memoryQuoteStore(() => NOW);
    const deposit = '0x9999999999999999999999999999999999999999';
    await store.save({
      requestId: AWAITING.terms.id, correlationId: 'corr-1', mode: 'funded', originAssetId: BASE_USDC.assetId, refundTo: REFUND,
      depositAddress: deposit, depositMemo: null, deadlineMs: NOW + 60_000, createdAtMs: NOW, amountIn: '1', amountInFormatted: '1',
      minAmountIn: '1', amountOut: AWAITING.terms.amountBaseUnits, timeEstimateSec: 35, signedResponse: '{}',
    }, 10_000_000);
    const originHash = `0x${'ab'.repeat(32)}`;
    const nearHash = 'Afo9C89HutErBxJgqU4N9NrhMqEAV5BZLnxNSFddqzWE';
    const good = { status: 'SUCCESS', correlationId: 'corr-1', quoteResponse: { correlationId: 'corr-1', quote: { depositAddress: deposit } },
      swapDetails: { originChainTxHashes: [{ hash: originHash, explorerUrl: 'https://evil.example/x' }], destinationChainTxHashes: [{ hash: nearHash, explorerUrl: 'https://evil.example/y' }], nearTxHashes: [nearHash] } };
    const service = (body: unknown) => createOneClickService(deps({ mode: 'dry', store, client: { ...createFixtureClient(signer), status: async () => body } }));
    const r = await service(good).status(AWAITING.terms.id);
    expect(r.ok && r.value).toMatchObject({
      hint: 'SUCCESS',
      originTxs: [{ hash: originHash, url: `https://basescan.org/tx/${originHash}` }],
      nearTxs: [{ hash: nearHash, url: `https://nearblocks.io/txns/${nearHash}` }],
    });
    expect(JSON.stringify(r)).not.toContain('evil.example');
    const other = { ...good, quoteResponse: { correlationId: 'corr-1', quote: { depositAddress: '0x8888888888888888888888888888888888888888' } } };
    expect(await service(other).status(AWAITING.terms.id)).toEqual({ ok: false, code: 'STATUS_MISMATCH' });
    expect(await service({ status: 'PAID_TO_MERCHANT' }).status(AWAITING.terms.id)).toEqual({ ok: false, code: 'STATUS_MISMATCH' });
  });
});

describe('HTTP client', () => {
  it('sends the API key only as a Bearer header to the fixed base URL, no redirects, no cache', async () => {
    const fetcher = vi.fn(async () => new Response('{"ok":1}', { status: 200 }));
    await createOneClickClient({ apiKey: 'k-123', fetcher }).quote({ a: 1 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://1click.chaindefuser.com/v0/quote');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer k-123');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
  });

  it('maps upstream failures to codes without forwarding upstream text', async () => {
    const fail = (status: number, message: string) => createOneClickClient({ fetcher: async () => new Response(JSON.stringify({ message }), { status }) });
    await expect(fail(400, 'Amount is too low for bridge, try at least 149983').quote({})).rejects.toMatchObject({ code: 'MIN_AMOUNT' });
    await expect(fail(400, 'Failed to get quote').quote({})).rejects.toMatchObject({ code: 'NO_LIQUIDITY' });
    await expect(fail(401, 'x').quote({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(fail(503, 'x').quote({})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(createOneClickClient({ fetcher: async () => { throw new Error('net'); } }).tokens()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(classifyUpstreamError(429, '')).toBe('RATE_LIMITED');
  });

  it('status passes the deposit address as a query parameter', async () => {
    const fetcher = vi.fn(async () => new Response('{"status":"PENDING_DEPOSIT"}', { status: 200 }));
    await createOneClickClient({ fetcher }).status('0xabc', null);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe('https://1click.chaindefuser.com/v0/status?depositAddress=0xabc');
  });
});

describe('Redis quote store', () => {
  it('uses the mainnet key prefix, NX lock with compare-and-delete release', async () => {
    const calls: Array<ReadonlyArray<string | number>> = [];
    const redis = vi.fn(async (args: ReadonlyArray<string | number>) => { calls.push(args); return args[0] === 'SET' ? 'OK' : args[0] === 'INCR' ? 1 : null; });
    const store = redisQuoteStore(redis);
    await store.withRequestLock('e'.repeat(64), async () => 1);
    expect(calls[0]?.slice(0, 2)).toEqual(['SET', `taply:mainnet:1click:lock:${'e'.repeat(64)}`]);
    expect(calls[0]).toContain('NX');
    expect(calls[1]?.[0]).toBe('EVAL');
    redis.mockResolvedValueOnce(null);
    expect(await store.withRequestLock('e'.repeat(64), async () => 1)).toBe('BUSY');
  });
});

describe('HTTP handlers and mode resolution', () => {
  const service = () => createOneClickService(deps());
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('https://mainnet.taplyapp.xyz/api/mainnet/oneclick/quote', { method: 'POST', body, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers } });

  it('404 on a Testnet build', async () => {
    expect((await handleQuote(post(JSON.stringify(input())), service, false)).status).toBe(404);
    expect((await handleStatus(new Request('https://x/api/mainnet/oneclick/status?requestId=1'), service, false)).status).toBe(404);
  });

  it('serves a verified quote with no-store and no deposit address', async () => {
    const res = await handleQuote(post(JSON.stringify(input())), service, true);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['deposit']).toBeNull();
  });

  it('refuses cross-site posts, wrong content type, oversized and invalid JSON', async () => {
    expect((await handleQuote(post('{}', { 'sec-fetch-site': 'cross-site' }), service, true)).status).toBe(403);
    expect((await handleQuote(post('{}', { 'content-type': 'text/plain' }), service, true)).status).toBe(415);
    expect((await handleQuote(post('x'.repeat(3000)), service, true)).status).toBe(413);
    expect((await handleQuote(post('{'), service, true)).status).toBe(400);
  });

  it('mode: off by default, never on Testnet, fixture refused on Vercel Production', () => {
    expect(parseOneClickMode(undefined)).toBe('off');
    expect(parseOneClickMode('live')).toBe('off');
    expect(resolveMode({ TAPLY_ONECLICK_MODE: 'dry' }, false)).toBe('off');
    expect(resolveMode({ TAPLY_ONECLICK_MODE: 'fixture', VERCEL_ENV: 'production' }, true)).toBe('off');
    expect(resolveMode({ TAPLY_ONECLICK_MODE: 'fixture', VERCEL_ENV: 'preview' }, true)).toBe('fixture');
    expect(resolveMode({ TAPLY_ONECLICK_MODE: 'funded' }, true)).toBe('funded'); // then refused by the service gate
  });
});
