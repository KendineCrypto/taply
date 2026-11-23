// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// The release gate is a reviewed code constant. These tests open it ONLY inside
// this test module to exercise the funded path; the shipped constant is unchanged.
vi.mock('@/lib/mainnet/release-gates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED: true,
}));

import { fixtureRequests, FIXTURE_CONTRACT } from '@/lib/mainnet/fixtures';
import { BASE_USDC, NATIVE_NEAR } from '@/lib/mainnet/oneclick/allowlist';
import { fixtureChain } from '../../chain';
import { createFixtureSigner, fixtureQuoteResponse } from '../fixture-client';
import type { OneClickClient } from '../client';
import { handleOrigins, handleResume } from '../http';
import { createOneClickService, ownerHashOf } from '../service';
import { memoryQuoteStore } from '../store';

/**
 * Funded 1Click path with SYNTHETIC signed responses (ephemeral key, real SDK
 * verification code). No network, no deposit address that exists anywhere.
 */
const NOW = Date.UTC(2026, 10, 13, 12, 20, 0);
const REFUND = '0x1111111111111111111111111111111111111111';
const DEPOSIT = '0x7777777777777777777777777777777777777777';
const SECRET = 'A'.repeat(43);
const OTHER = 'B'.repeat(43);
const signer = createFixtureSigner();
const request = fixtureRequests(NOW).find(e => e.scenario.name === 'usdc-awaiting')!.request;
const LISTED = [{ assetId: BASE_USDC.assetId, blockchain: 'base', symbol: 'USDC', decimals: 6, contractAddress: BASE_USDC.contractAddress }];

function fundedClient(overrides: Partial<OneClickClient> = {}): OneClickClient & { quote: ReturnType<typeof vi.fn> } {
  let correlationId = 'none';
  const quote = vi.fn(async (body: unknown) => {
    const unsigned = fixtureQuoteResponse(body as Record<string, unknown>, NOW);
    correlationId = unsigned.correlationId;
    return signer.signResponse({ ...unsigned, quote: { ...unsigned.quote, depositAddress: DEPOSIT, deadline: new Date(NOW + 15 * 60_000).toISOString() } });
  });
  const status = async () => ({ status: 'PENDING_DEPOSIT', correlationId, quoteResponse: { correlationId, quote: { depositAddress: DEPOSIT } } });
  return { quote, status, tokens: async () => LISTED, ...overrides } as OneClickClient & { quote: ReturnType<typeof vi.fn> };
}
function setup(client = fundedClient()) {
  const store = memoryQuoteStore();
  const service = createOneClickService({ mode: 'funded', chain: fixtureChain(() => NOW), client, store, managerPublicKey: signer.publicKey, now: () => NOW });
  return { store, service, client };
}
const input = (extra: Record<string, unknown> = {}) => ({ requestId: request.terms.id, originAsset: BASE_USDC.assetId, refundTo: REFUND, attemptSecret: SECRET, ...extra });

describe('funded 1Click quotes (gate opened only in this test module)', () => {
  it('sends dry:false with Taply fixed terms and gives the deposit address to the owner only', async () => {
    const s = setup();
    const r = await s.service.prepareQuote(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sent = s.client.quote.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ dry: false, swapType: 'EXACT_OUTPUT', recipient: FIXTURE_CONTRACT, amount: request.terms.amountBaseUnits, refundTo: REFUND, depositType: 'ORIGIN_CHAIN', refundType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN' });
    expect(JSON.parse(String(sent['customRecipientMsg']))).toEqual({ id: request.terms.id, expectedTermsHash: request.termsHash, action: 'pay_instant' });
    expect(r.value).toMatchObject({ mode: 'funded', fundingEnabled: true, deposit: { address: DEPOSIT, memo: null }, depositWithheldReason: null, amountOut: request.terms.amountBaseUnits, refundTo: REFUND, released: null });
    // The ledger stores only a hash of the secret.
    const [attempt] = await s.store.attempts(request.terms.id);
    expect(attempt!.ownerHash).toBe(ownerHashOf(SECRET));
    expect(JSON.stringify(attempt)).not.toContain(SECRET);
    // Public status: no deposit, no refund address.
    const pub = await s.service.status(request.terms.id);
    expect(pub.ok && pub.value.hint).toBe('PENDING_DEPOSIT');
    expect(JSON.stringify(pub)).not.toContain(DEPOSIT);
    expect(JSON.stringify(pub)).not.toContain(REFUND);
  });

  it('another browser cannot see, replace or duplicate the active attempt; the owner resumes it after a refresh', async () => {
    const s = setup();
    const first = await s.service.prepareQuote(input());
    expect(await s.service.prepareQuote(input({ attemptSecret: OTHER, refundTo: '0x2222222222222222222222222222222222222222' }))).toEqual({ ok: false, code: 'PAYMENT_IN_PROGRESS', reason: 'ATTEMPT_OPEN' });
    expect(await s.service.resume({ requestId: request.terms.id, attemptSecret: OTHER })).toEqual({ ok: false, code: 'NO_QUOTE' });
    const resumed = await s.service.resume({ requestId: request.terms.id, attemptSecret: SECRET });
    expect(resumed.ok && resumed.value.quote.deposit?.address).toBe(DEPOSIT);
    expect(resumed.ok && resumed.value.quote.attemptId).toBe(first.ok && first.value.attemptId);
    expect(resumed.ok && resumed.value.status?.refundTo).toBe(REFUND);
    expect(s.client.quote).toHaveBeenCalledTimes(1);
  });

  it('only the verified route is fundable: Solana/Tron and unknown assets are refused, the origin list is Base only', async () => {
    const tokens = [...LISTED, { assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', blockchain: 'sol', symbol: 'USDC', decimals: 6, contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }];
    const s = setup(fundedClient({ tokens: async () => tokens }));
    expect(await s.service.prepareQuote(input({ originAsset: tokens[1]!.assetId, refundTo: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' }))).toEqual({ ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    const origins = await s.service.origins();
    expect(origins.ok && origins.value.map(o => o.chain)).toEqual(['base']);
    const res = await handleOrigins(new Request('https://x/api/mainnet/oneclick/origins'), () => s.service, true, async () => true);
    expect(await res.json()).toMatchObject({ funding: true });
  });

  it('quotes native NEAR for exact USDC and never uses Base evidence to replace the attempt', async () => {
    const depositAddress = 'a'.repeat(64);
    const refundTo = 'payer.near';
    let now = NOW;
    let correlationId = '';
    const quote = vi.fn(async (body: unknown) => {
      const unsigned = fixtureQuoteResponse(body as Record<string, unknown>, NOW);
      correlationId = unsigned.correlationId;
      return signer.signResponse({ ...unsigned, quote: { ...unsigned.quote, depositAddress, deadline: new Date(NOW + 15 * 60_000).toISOString() } });
    });
    const originRpc = { call: vi.fn() };
    const service = createOneClickService({
      mode: 'funded', chain: fixtureChain(() => NOW), store: memoryQuoteStore(),
      client: fundedClient({
        quote,
        tokens: async () => [...LISTED, { ...NATIVE_NEAR, blockchain: 'near', symbol: 'wNEAR' }],
        status: async () => ({ status: 'REFUNDED', correlationId, quoteResponse: { correlationId, quote: { depositAddress } } }),
      }),
      now: () => now, managerPublicKey: signer.publicKey, originRpc,
    });

    const origins = await service.origins();
    expect(origins.ok && origins.value.map(o => o.chain)).toEqual(['base', 'near']);
    expect(await service.prepareQuote(input({ originAsset: NATIVE_NEAR.assetId, refundTo: 'payer.testnet' }))).toEqual({ ok: false, code: 'REFUND_ADDRESS_INVALID' });
    const payment = await service.prepareQuote(input({ originAsset: NATIVE_NEAR.assetId, refundTo }));
    expect(quote).toHaveBeenCalledWith(expect.objectContaining({
      originAsset: NATIVE_NEAR.assetId, refundTo, swapType: 'EXACT_OUTPUT', amount: request.terms.amountBaseUnits,
    }));
    expect(payment.ok && payment.value.deposit?.address).toBe(depositAddress);

    now += 16 * 60_000;
    const resumed = await service.resume({ requestId: request.terms.id, attemptSecret: SECRET });
    expect(resumed.ok && resumed.value.evidence?.verdict).toEqual({ blocked: 'EVIDENCE_UNAVAILABLE' });
    expect(originRpc.call).not.toHaveBeenCalled();
    expect(quote).toHaveBeenCalledTimes(1);
  });

  it('a signed funded quote without a deposit address, or with the refund address as deposit, is rejected and never shown', async () => {
    for (const depositAddress of [undefined, REFUND]) {
      const client = fundedClient({
        quote: vi.fn(async (body: unknown) => {
          const u = fixtureQuoteResponse(body as Record<string, unknown>, NOW);
          return signer.signResponse({ ...u, quote: { ...u.quote, ...(depositAddress ? { depositAddress } : {}), deadline: new Date(NOW + 15 * 60_000).toISOString() } });
        }),
      });
      const s = setup(client);
      expect(await s.service.prepareQuote(input())).toEqual({ ok: false, code: 'QUOTE_REJECTED', reason: 'DEPOSIT_ADDRESS_INVALID' });
      const resumed = await s.service.resume({ requestId: request.terms.id, attemptSecret: SECRET });
      expect(resumed).toEqual({ ok: false, code: 'NO_QUOTE' });
    }
  });

  it('an upstream timeout leaves the attempt uncertain: no second quote, no address, honest code', async () => {
    const s = setup(fundedClient({ quote: vi.fn(async () => { throw new Error('timeout'); }) }));
    expect(await s.service.prepareQuote(input())).toEqual({ ok: false, code: 'ATTEMPT_UNCERTAIN' });
    expect(await s.service.prepareQuote(input())).toEqual({ ok: false, code: 'ATTEMPT_UNCERTAIN' });
    expect(await s.service.prepareQuote(input({ attemptSecret: OTHER }))).toEqual({ ok: false, code: 'ATTEMPT_UNCERTAIN' });
    expect(s.client.quote).toHaveBeenCalledTimes(1);
  });

  it('the resume endpoint takes the secret in a same-origin POST body only', async () => {
    const s = setup();
    await s.service.prepareQuote(input());
    const post = (body: string, headers: Record<string, string> = {}) => handleResume(new Request('https://m.taply/api/mainnet/oneclick/attempt', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), () => s.service, true, async () => true);
    expect((await post(JSON.stringify({ requestId: request.terms.id, attemptSecret: SECRET }))).status).toBe(200);
    expect((await post(JSON.stringify({ requestId: request.terms.id, attemptSecret: SECRET }), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post(JSON.stringify({ requestId: request.terms.id, attemptSecret: SECRET, extra: 1 }))).status).toBe(400);
    const notMainnet = await handleResume(new Request('https://x/', { method: 'POST' }), () => s.service, false, async () => true);
    expect(notMainnet.status).toBe(404);
  });
});
