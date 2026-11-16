import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MainnetLocaleProvider } from '@/lib/mainnet/copy';
import { mainnetEn } from '@/lib/i18n/dictionaries/mainnet-en';
import { mainnetTr } from '@/lib/i18n/dictionaries/mainnet-tr';
import { fixtureRequests } from '@/lib/mainnet/fixtures';

/**
 * Funded deposit screen with SYNTHETIC server answers. The deposit address below
 * is a test value that exists only in this file; nothing is fetched or sent.
 */
vi.mock('@/lib/mainnet/config', () => ({
  MAINNET_CONFIG: { ok: true, network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear-mainnet', explorerBaseUrl: 'https://nearblocks.io', contract: { status: 'not_configured' }, profile: null, shareOrigin: null, fixtures: true, signingEnabled: false },
}));
const { IntentsCheckout } = await import('../PayRequest');

const NOW = Date.now();
const request = fixtureRequests(NOW).find(e => e.scenario.name === 'usdc-awaiting')!.request;
const REFUND = '0x1111111111111111111111111111111111111111';
const DEPOSIT = '0x7777777777777777777777777777777777777777';
const funded = {
  mode: 'funded', fundingEnabled: true, requestId: request.terms.id, attemptId: 'attempt-1', correlationId: 'corr-1', originAssetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  amountIn: '12628863', amountInFormatted: '12.628863', minAmountIn: '12503826', amountOut: request.terms.amountBaseUnits,
  deadline: new Date(NOW + 15 * 60_000).toISOString(), timeEstimateSec: 35, refundTo: REFUND, recipient: request.terms.contractId,
  destinationAsset: 'nep141:x', deposit: { address: DEPOSIT, memo: null }, depositWithheldReason: null, signatureVerified: true, reused: false, released: null,
};
const availability = { origins: [{ assetId: funded.originAssetId, chain: 'base' as const, symbol: 'USDC' as const, contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', refundAddressFormat: 'evm' as const, source: 'recorded-live-quote' as const }], funding: true };
const wrap = (ui: ReactNode, locale: 'en' | 'tr' = 'en') => render(<MainnetLocaleProvider locale={locale}>{ui}</MainnetLocaleProvider>);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

async function getQuote(answer: unknown, opts: { hint?: Parameters<typeof IntentsCheckout>[0]['hint']; locale?: 'en' | 'tr' } = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })));
  const view = wrap(<IntentsCheckout request={request} availability={availability} hint={opts.hint ?? null} onPrepared={() => {}} />, opts.locale);
  const copy = opts.locale === 'tr' ? mainnetTr : mainnetEn;
  fireEvent.change(document.getElementById('refund')!, { target: { value: REFUND } });
  fireEvent.click(screen.getByTestId('get-quote'));
  await waitFor(() => expect(screen.queryByTestId('quote-review') ?? screen.queryByTestId('quote-error')).toBeTruthy());
  return { view, copy };
}

describe('funded Base USDC deposit screen', () => {
  it('shows exact amount, Base-only warning, address QR, copy buttons and no-resend guidance', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await getQuote(funded);
    expect(screen.getByTestId('quote-review').getAttribute('data-attempt-state')).toBe('awaiting-deposit');
    expect(screen.getByTestId('send-exactly').textContent).toBe('Send 12.628863 USDC on Base');
    expect(screen.getByTestId('network-only').textContent).toBe(mainnetEn.intents.networkOnly);
    expect(screen.getByTestId('deposit-address').textContent).toBe(DEPOSIT);
    expect(screen.getByRole('img', { name: `${mainnetEn.intents.qrLabel}: ${DEPOSIT}` })).toBeTruthy();
    expect(screen.getByText(mainnetEn.intents.afterSend)).toBeTruthy();
    fireEvent.click(screen.getByTestId('copy-deposit'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DEPOSIT));
    fireEvent.click(screen.getByTestId('copy-amount'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('12.628863'));
    expect(screen.queryByTestId('deposit-withheld')).toBeNull();
  });

  it('a memo cannot be skipped: copy buttons appear only after confirming it', async () => {
    await getQuote({ ...funded, deposit: { address: DEPOSIT, memo: '424242' } });
    expect(screen.getByTestId('deposit-memo').textContent).toContain('424242');
    expect(screen.queryByTestId('copy-deposit')).toBeNull();
    fireEvent.click(screen.getByTestId('memo-confirm'));
    expect(screen.getByTestId('copy-deposit')).toBeTruthy();
  });

  it('removes the QR and address once 1Click has seen a deposit', async () => {
    await getQuote(funded, { hint: { status: 'KNOWN_DEPOSIT_TX', sinceMs: NOW, refundTo: null, originTxs: [], nearTxs: [], refundedAmountFormatted: null } });
    expect(screen.queryByTestId('deposit-instructions')).toBeNull();
    expect(screen.getByTestId('deposit-seen').textContent).toBe(mainnetEn.intents.received);
  });

  it('an expired, unpaid quote hides the address and offers an explicit new quote (never automatic)', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...funded, deadline: new Date(NOW - 1000).toISOString() }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    wrap(<IntentsCheckout request={request} availability={availability} onPrepared={() => {}} />);
    fireEvent.change(document.getElementById('refund')!, { target: { value: REFUND } });
    fireEvent.click(screen.getByTestId('get-quote'));
    await waitFor(() => expect(screen.getByTestId('quote-expired')).toBeTruthy());
    expect(screen.queryByTestId('deposit-instructions')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('new-quote'));
    expect(screen.getByTestId('get-quote')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the refund address as deposit', { deposit: { address: REFUND, memo: null } }],
    ['a non-EVM deposit address', { deposit: { address: 'bc1qxyz', memo: null } }],
    ['a deposit while funding is off', { fundingEnabled: false }],
    ['a deposit on a dry quote', { mode: 'dry' }],
    ['another origin asset', { originAssetId: 'nep141:sol-x.omft.near' }],
    ['another amount', { amountOut: '1' }],
    ['another recipient', { recipient: 'attacker.near' }],
  ])('refuses %s', async (_label, change) => {
    await getQuote({ ...funded, ...change });
    expect(screen.getByTestId('quote-error').textContent).toBe(mainnetEn.intents.errors['QUOTE_REJECTED']);
    expect(screen.queryByTestId('deposit-address')).toBeNull();
  });

  it('after a refresh, the same browser resumes its own attempt through the owner endpoint', async () => {
    localStorage.setItem(`taply.mainnet.1click.attempt:${request.terms.id}`, 'S'.repeat(43));
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ quote: funded, status: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    wrap(<IntentsCheckout request={request} availability={availability} onPrepared={() => {}} />);
    expect(screen.getByTestId('quote-resuming')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('deposit-address').textContent).toBe(DEPOSIT));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/mainnet/oneclick/attempt');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ requestId: request.terms.id, attemptSecret: 'S'.repeat(43) });
  });

  it('Turkish copy has the same structure', async () => {
    await getQuote(funded, { locale: 'tr' });
    expect(screen.getByTestId('send-exactly').textContent).toBe('Base üzerinde 12.628863 USDC gönderin');
    expect(screen.getByTestId('network-only').textContent).toBe(mainnetTr.intents.networkOnly);
    expect(Object.keys(mainnetTr.intents).sort()).toEqual(Object.keys(mainnetEn.intents).sort());
    expect(Object.keys(mainnetTr.intents.errors).sort()).toEqual(Object.keys(mainnetEn.intents.errors).sort());
  });
});
