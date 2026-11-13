import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MainnetLocaleProvider } from '@/lib/mainnet/copy';
import { mainnetEn } from '@/lib/i18n/dictionaries/mainnet-en';
import { mainnetTr } from '@/lib/i18n/dictionaries/mainnet-tr';
import { fixtureRequests } from '@/lib/mainnet/fixtures';
import type { MainnetRequest } from '@/lib/mainnet/fixtures';
import { mainnetConnectorOptions } from '@/lib/mainnet/wallet-config';
import { acceptMainnetAccount } from '@/lib/mainnet/wallet';

// A fixture-mode mainnet config for the components (the test process env is Testnet).
vi.mock('@/lib/mainnet/config', () => ({
  MAINNET_CONFIG: {
    ok: true,
    network: 'near-mainnet',
    rpcUrl: 'https://rpc.mainnet.fastnear.com',
    rpcProviderId: 'fastnear-mainnet',
    explorerBaseUrl: 'https://nearblocks.io',
    contract: { status: 'not_configured' },
    profile: null,
    shareOrigin: null,
    fixtures: true,
    signingEnabled: false,
  },
}));
vi.mock('@/lib/mainnet/wallet', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMainnetWallet: () => ({ status: 'idle', accountId: null, walletName: null, error: null, publicKey: null, signerWallet: () => null, connect: async () => {}, disconnect: async () => {} }),
}));

const { PaymentStatusPanel, IntentsCheckout } = await import('../PayRequest');

const NOW = Date.now();
const byName = (name: string) => fixtureRequests(NOW).find((e) => e.scenario.name === name)!.request;
const wrap = (ui: ReactNode, locale: 'en' | 'tr' = 'en') => render(<MainnetLocaleProvider locale={locale}>{ui}</MainnetLocaleProvider>);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function shape(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return typeof value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, shape((value as Record<string, unknown>)[k])]));
}

describe('mainnet copy', () => {
  it('Turkish has exactly the English keys', () => {
    expect(shape(mainnetTr)).toEqual(shape(mainnetEn));
  });

  it('says Mainnet, real funds, unaudited and capped in both languages', () => {
    expect(mainnetEn.network.banner).toMatch(/Mainnet.*real funds.*unaudited/);
    expect(mainnetTr.network.banner).toMatch(/Mainnet.*gerçek para.*denetlenmemiş/);
    expect(mainnetEn.network.capLine).toContain('1 NEAR');
    expect(mainnetEn.network.capLine).toContain('25 USDC');
    expect(mainnetTr.network.capLine).toContain('25 USDC');
  });
});

describe('mainnet wallet configuration (near-connect 0.12.0 types)', () => {
  it('mainnet only, no key added on sign-in, never auto-connects', () => {
    const o = mainnetConnectorOptions('https://rpc.mainnet.fastnear.com', undefined);
    expect(o.network).toBe('mainnet');
    expect(o.providers).toEqual({ mainnet: ['https://rpc.mainnet.fastnear.com'] });
    expect(o.features).toEqual({ mainnet: true, signInWithoutAddKey: true, signAndSendTransaction: true });
    expect(o.autoConnect).toBe(false);
    expect(JSON.stringify(o)).not.toMatch(/testnet/i);
  });

  it('a Testnet account is never accepted into a mainnet session', () => {
    expect(acceptMainnetAccount('alice.testnet')).toBeNull();
    expect(acceptMainnetAccount('testnet')).toBeNull();
    expect(acceptMainnetAccount('alice.near')).toBe('alice.near');
    expect(acceptMainnetAccount('a'.repeat(64))).toBe('a'.repeat(64));
    expect(acceptMainnetAccount('Bad Name')).toBeNull();
  });
});

describe('PaymentStatusPanel', () => {
  const panel = (request: MainnetRequest, status: string | null = null, locale: 'en' | 'tr' = 'en') =>
    wrap(
      <PaymentStatusPanel
        request={request}
        readAtMs={NOW}
        hint={status === null ? null : { status: status as never, sinceMs: NOW, refundTo: null, originTxs: [], nearTxs: [], refundedAmountFormatted: null }}
        onRefresh={() => {}}
      />,
      locale,
    );
  const state = () => screen.getByTestId('payment-state').querySelector('[data-state]')!.getAttribute('data-state');

  it.each([
    ['usdc-awaiting', null, 'AWAITING_PAYMENT'],
    ['usdc-deposit-seen', 'KNOWN_DEPOSIT_TX', 'DEPOSIT_OBSERVED'],
    ['usdc-processing', 'PROCESSING', 'PROCESSING'],
    ['usdc-success-unsettled', 'SUCCESS', 'PROCESSING'],
    ['usdc-recorded', 'SUCCESS', 'PAYMENT_RECORDED'],
    ['usdc-refunded', 'REFUNDED', 'REFUNDED'],
    ['usdc-failed', 'FAILED', 'FAILED'],
    ['usdc-r2-unknown', 'SUCCESS', 'UNKNOWN'],
    ['usdc-payout-failed', 'SUCCESS', 'FAILED'],
  ])('%s with hint %s shows %s and never Verified', (name, hint, expected) => {
    panel(byName(name), hint);
    expect(state()).toBe(expected);
    expect(screen.queryByText(mainnetEn.status.states.VERIFIED)).toBeNull();
    expect(screen.getByTestId('verified-unavailable').textContent).toBe(mainnetEn.status.verifiedUnavailable);
  });

  it('Payment recorded states its contract-only limit and forbids repaying', () => {
    panel(byName('usdc-recorded'), 'SUCCESS');
    expect(screen.getByText(mainnetEn.status.recordedLimit)).toBeTruthy();
    expect(screen.getByTestId('do-not-repay')).toBeTruthy();
  });

  it('R-2 unknown explains no automatic retry, in Turkish too', () => {
    panel(byName('usdc-r2-unknown'), 'SUCCESS', 'tr');
    expect(screen.getByText(mainnetTr.status.states.UNKNOWN)).toBeTruthy();
    expect(screen.getByText(mainnetTr.status.details.payout_in_flight_stale)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry|yeniden dene/i })).toBeNull();
  });
});

/** Answers the origins list (empty -> Base fallback) and delegates the quote call. */
function routed(quote: () => Response) {
  return vi.fn(async (url: string) => (String(url).endsWith('/origins') ? new Response(JSON.stringify({ origins: [] }), { status: 200 }) : quote()));
}
const quoteCalls = (f: ReturnType<typeof routed>) => f.mock.calls.filter((c) => !String(c[0]).endsWith('/origins'));

describe('IntentsCheckout (Base USDC)', () => {
  const request = byName('usdc-awaiting');
  const goodQuote = {
    mode: 'fixture', fundingEnabled: false, requestId: request.terms.id, correlationId: 'c', originAssetId: 'x',
    amountIn: '12628863', amountInFormatted: '12.628863', minAmountIn: '12628863', amountOut: request.terms.amountBaseUnits,
    deadline: new Date(NOW + 15 * 60_000).toISOString(), timeEstimateSec: 35, refundTo: '0x1111111111111111111111111111111111111111',
    recipient: request.terms.contractId, destinationAsset: 'nep141:x', deposit: null, depositWithheldReason: 'DRY_QUOTE', signatureVerified: true, reused: false,
  };

  it('validates the refund address before asking the server', () => {
    const fetcher = routed(() => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetcher);
    wrap(<IntentsCheckout request={request} onPrepared={() => {}} />);
    fireEvent.change(screen.getByLabelText(mainnetEn.intents.refundLabel), { target: { value: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD' } });
    fireEvent.blur(screen.getByLabelText(mainnetEn.intents.refundLabel));
    expect(screen.getByText(mainnetEn.intents.refundErrors.checksum)).toBeTruthy();
    expect((screen.getByTestId('get-quote') as HTMLButtonElement).disabled).toBe(true);
    expect(quoteCalls(fetcher)).toHaveLength(0);
  });

  it('shows verified instructions with the exact principal and withholds the deposit address', async () => {
    const fetcher = routed(() => new Response(JSON.stringify(goodQuote), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const prepared = vi.fn();
    wrap(<IntentsCheckout request={request} onPrepared={prepared} />);
    fireEvent.change(screen.getByLabelText(mainnetEn.intents.refundLabel), { target: { value: goodQuote.refundTo } });
    fireEvent.click(screen.getByTestId('get-quote'));
    await waitFor(() => expect(screen.getByTestId('quote-review')).toBeTruthy());
    const [url, init] = quoteCalls(fetcher)[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/mainnet/oneclick/quote');
    expect(JSON.parse(String(init.body))).toEqual({ requestId: request.terms.id, originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', refundTo: goodQuote.refundTo });
    expect(screen.getByText('12.5 USDC')).toBeTruthy();
    expect(screen.getByText('12.628863 USDC · Base')).toBeTruthy();
    expect(screen.getByTestId('deposit-withheld').textContent).toContain(mainnetEn.intents.depositHidden);
    expect(screen.getByText(mainnetEn.intents.fixtureQuote)).toBeTruthy();
    expect(prepared).toHaveBeenCalledOnce();
  });

  it('refuses a server answer that is not the exact principal to the pinned contract', async () => {
    vi.stubGlobal('fetch', routed(() => new Response(JSON.stringify({ ...goodQuote, amountOut: '1' }), { status: 200 })));
    wrap(<IntentsCheckout request={request} onPrepared={() => {}} />);
    fireEvent.change(screen.getByLabelText(mainnetEn.intents.refundLabel), { target: { value: goodQuote.refundTo } });
    fireEvent.click(screen.getByTestId('get-quote'));
    await waitFor(() => expect(screen.getByTestId('quote-error').textContent).toBe(mainnetEn.intents.errors['QUOTE_REJECTED']));
  });

  it.each(['REQUEST_EXPIRES_TOO_SOON', 'ACTIVE_QUOTE_EXISTS', 'PREVIOUS_QUOTE_IN_PROGRESS', 'UPSTREAM_MIN_AMOUNT', 'FUNDED_QUOTES_NOT_APPROVED'])(
    'server error %s is shown in plain language',
    async (code) => {
      vi.stubGlobal('fetch', routed(() => new Response(JSON.stringify({ error: code }), { status: 409 })));
      wrap(<IntentsCheckout request={request} onPrepared={() => {}} />);
      fireEvent.change(screen.getByLabelText(mainnetEn.intents.refundLabel), { target: { value: goodQuote.refundTo } });
      fireEvent.click(screen.getByTestId('get-quote'));
      await waitFor(() => expect(screen.getByTestId('quote-error').textContent).toBe(mainnetEn.intents.errors[code]));
    },
  );
});
