import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MainnetLocaleProvider } from '@/lib/mainnet/copy';
import { fixtureRequests } from '@/lib/mainnet/fixtures';
import { liveEn, liveTr } from '@/lib/mainnet/live-copy';
import { ORIGIN_COPY } from '@/lib/mainnet/origin-copy';
import { joinTokenFromHash, liveStore, MAINNET_LIVE_BASE, createLiveApi } from '@/lib/mainnet/live';

vi.mock('@/lib/mainnet/config', () => ({
  MAINNET_CONFIG: { ok: true, network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear-mainnet', explorerBaseUrl: 'https://nearblocks.io', contract: { status: 'not_configured' }, profile: null, shareOrigin: null, fixtures: true, signingEnabled: false },
}));
vi.mock('@/lib/mainnet/wallet', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMainnetWallet: () => ({ status: 'idle', accountId: null, walletName: null, error: null, publicKey: null, signerWallet: () => null, connect: async () => {}, disconnect: async () => {} }),
}));
const { ContractReceipt, ACTIVITY_COPY } = await import('../Activity');

const NOW = Date.now();
const byName = (n: string) => fixtureRequests(NOW).find((e) => e.scenario.name === n)!.request;
const wrap = (ui: ReactNode, locale: 'en' | 'tr' = 'en') => render(<MainnetLocaleProvider locale={locale}>{ui}</MainnetLocaleProvider>);
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

function shape(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return typeof v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
}

describe('EN/TR parity of the phase 2 copy', () => {
  it('Live, Activity and origin copy have identical keys', () => {
    expect(shape(liveTr)).toEqual(shape(liveEn));
    expect(shape(ACTIVITY_COPY.tr)).toEqual(shape(ACTIVITY_COPY.en));
    expect(shape(ORIGIN_COPY.tr)).toEqual(shape(ORIGIN_COPY.en));
  });
});

describe('contract-state receipt', () => {
  it('a FINAL_PAID request shows "Payment recorded (contract state)", the router payer, and never "Verified"', async () => {
    wrap(<ContractReceipt id={byName('usdc-recorded').terms.id} />);
    await waitFor(() => expect(screen.getByTestId('receipt-state').getAttribute('data-paid')).toBe('recorded'));
    expect(screen.getByText(ACTIVITY_COPY.en.recorded)).toBeTruthy();
    expect(screen.getByText(/intents\.near/)).toBeTruthy();
    expect(screen.getByTestId('receipt-amount').textContent).toBe('9.99 USDC');
    expect(document.body.textContent).not.toMatch(/Verified Paid|Independently verified/);
  });
  it('an open or failed request has no final payment record', async () => {
    wrap(<ContractReceipt id={byName('usdc-payout-failed').terms.id} />, 'tr');
    await waitFor(() => expect(screen.getByTestId('receipt-state').getAttribute('data-paid')).toBe('no'));
    expect(screen.getByText(ACTIVITY_COPY.tr.notFinal)).toBeTruthy();
  });
  it('an unknown id is reported missing', async () => {
    wrap(<ContractReceipt id={'e'.repeat(64)} />);
    await waitFor(() => expect(screen.getByText(ACTIVITY_COPY.en.missing)).toBeTruthy());
  });
});

describe('Mainnet Live client', () => {
  it('reads only a well-formed #j= join token', () => {
    expect(joinTokenFromHash('#j=abcdefghijklmnopqrstuv')).toBe('abcdefghijklmnopqrstuv');
    expect(joinTokenFromHash('#j=short')).toBeNull();
    expect(joinTokenFromHash('#x=abcdefghijklmnopqrstuv')).toBeNull();
  });
  it('uses mainnet-only storage keys and API base', async () => {
    liveStore.saveParticipant('r'.repeat(22), 't'.repeat(22));
    expect(Object.keys(localStorage)).toEqual([`taply.mainnet.live.customer.v1:${'r'.repeat(22)}`]);
    expect(localStorage.getItem('taply.live.customer.v1:' + 'r'.repeat(22))).toBeNull();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'REQUEST_NOT_OPEN' }), { status: 409 }));
    await expect(createLiveApi(fetcher).create('a'.repeat(64))).rejects.toMatchObject({ code: 'REQUEST_NOT_OPEN' });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(`${MAINNET_LIVE_BASE}/rooms`);
  });
  it('an unknown server error code becomes UNAVAILABLE, never trusted text', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'PAID' }), { status: 500 }));
    await expect(createLiveApi(fetcher).sync('r'.repeat(22), 'customer', 't'.repeat(22))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('a stored merchant room for another request is ignored', () => {
    const room = { roomId: 'r'.repeat(22), merchantToken: 'm'.repeat(22), joinToken: 'j'.repeat(22), requestId: 'a'.repeat(64), expiresAtMs: Date.now() + 60_000 };
    liveStore.saveMerchant('b'.repeat(64), room);
    expect(liveStore.merchant('b'.repeat(64))).toBeNull();
    liveStore.saveMerchant('a'.repeat(64), room);
    expect(liveStore.merchant('a'.repeat(64))).toEqual(room);
  });
});
