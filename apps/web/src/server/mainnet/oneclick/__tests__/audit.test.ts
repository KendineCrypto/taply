// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config as proxyConfig } from '@/proxy';
import { BASE_USDC } from '@/lib/mainnet/oneclick/allowlist';
import { createOneClickClient } from '../client';
import { createFixtureSigner, fixtureQuoteResponse } from '../fixture-client';
import { buildQuoteRequest, type TaplyQuoteRequest } from '../quote-request';
import { verifyQuoteResponse, MANAGER_PUBLIC_KEY } from '../verify';
import { verifyQuoteSignatureSdk } from '../sdk';

describe('independent integration audit regressions', () => {
  it('accepts the recorded live dry response with the production SDK key, rejecting tampering and replay', () => {
    const evidence = JSON.parse(readFileSync(new URL('../../../../../../../docs/evidence/mainnet-audit-2026-11-13/live-dry-probe.json', import.meta.url), 'utf8'));
    const sent = evidence.request as TaplyQuoteRequest;
    const context = { nowMs: Date.parse(evidence.observedAt), requestExpiresAtMs: Date.parse(sent.deadline) + 3_600_000, managerPublicKey: MANAGER_PUBLIC_KEY };
    expect(sent.dry).toBe(true);
    expect(verifyQuoteResponse(evidence.body, sent, context).ok).toBe(true);
    expect(verifyQuoteResponse({ ...evidence.body, quote: { ...evidence.body.quote, amountOut: '999999' } }, sent, context).ok).toBe(false);
    expect(verifyQuoteResponse(evidence.body, sent, { ...context, nowMs: context.nowMs + 300_000 }).ok).toBe(false);
  });
  it.each(['purpose', 'next-router-prefetch'])('prefetch header %s cannot bypass API isolation', (header) => {
    expect(unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig: {},
      url: 'https://mainnet.taplyapp.xyz/api/handshake/health',
      headers: { [header]: header === 'purpose' ? 'prefetch' : '1' },
    })).toBe(true);
  });

  it('rejects a dry execution deadline not covered by the SDK signature', () => {
    const now = Date.UTC(2026, 10, 13, 12);
    const signer = createFixtureSigner();
    const sent = buildQuoteRequest({ dry: true, origin: BASE_USDC,
      refundTo: '0x1111111111111111111111111111111111111111', contractId: 'devkendinecrypto.near',
      requestId: 'a'.repeat(64), termsHash: 'b'.repeat(64), amountBaseUnits: '1000000', deadlineMs: now + 1_200_000 });
    const signed = signer.signResponse(fixtureQuoteResponse(sent as unknown as Record<string, unknown>, now));
    const tampered = { ...signed, quote: { ...signed.quote, deadline: new Date(now + 2_400_000).toISOString() } };
    expect(verifyQuoteSignatureSdk(tampered, signer.publicKey)).toBe(true);
    expect(verifyQuoteResponse(tampered, sent, { nowMs: now, requestExpiresAtMs: now + 3_600_000, managerPublicKey: signer.publicKey }).ok).toBe(false);
  });

  it('caps actual UTF-8 response bytes before accepting JSON', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ x: '😀'.repeat(12) })));
    await expect(createOneClickClient({ fetcher, maxBytes: 40 }).tokens()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('keeps timeout active while the response body stalls', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel })));
      const result = createOneClickClient({ fetcher, timeoutMs: 50 }).tokens().then(() => 'accepted', () => 'rejected');
      let outcome = 'pending';
      void result.then(v => { outcome = v; });
      await vi.advanceTimersByTimeAsync(60);
      expect(outcome).toBe('rejected');
      expect(cancel).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
