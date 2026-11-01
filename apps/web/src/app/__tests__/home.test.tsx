import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeBalance, ReadResult } from '@taply/near-client';
import HomePage from '../page';
import { I18nProvider } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import { WalletProvider } from '@/lib/wallet/provider';
import { WalletError } from '@/lib/wallet/adapter';
import type { WalletAdapter, WalletSession } from '@/lib/wallet/adapter';

/**
 * Home screen against a fake wallet and a fake chain client. Nothing here
 * reaches a wallet or NEAR RPC, and no assertion here is Testnet evidence.
 */

const readNativeBalance = vi.fn<(accountId: string) => Promise<ReadResult<NativeBalance>>>();

vi.mock('@/lib/near/client', () => ({
  getNearClient: () => ({ readNativeBalance }),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const SESSION: WalletSession = { accountId: 'alice.testnet', walletId: 'fake', walletName: 'Fake Wallet' };

function fakeAdapter(overrides: Partial<WalletAdapter> = {}): WalletAdapter {
  return {
    restore: async () => null,
    connect: async () => SESSION,
    disconnect: async () => undefined,
    subscribe: () => () => undefined,
    // Home never signs; a call here is a bug.
    signAndSendTransaction: async () => {
      throw new Error('home must not sign');
    },
    ...overrides,
  };
}

function verified(source: 'rpc' | 'mock' = 'rpc'): ReadResult<NativeBalance> {
  return {
    observation: {
      source,
      assurance: source === 'mock' ? 'unverified' : 'verified_final',
      data: {
        accountId: 'alice.testnet',
        assetId: 'near:native',
        amountYoctoNear: '1015695997481455830262305522945',
        lockedYoctoNear: '0',
        storageUsageBytes: '1186783',
      },
      observedBlock: source === 'mock' ? null : { hash: 'h', height: '275322097', timestampNs: '1793289882103894449' },
      checkedAt: '2026-10-29T16:04:56.240Z',
      stale: false,
      rpcAvailable: source !== 'mock',
    },
    error: null,
  };
}

function renderHome(adapter: WalletAdapter | null, locale: Locale = 'en') {
  return render(
    <I18nProvider locale={locale}>
      <WalletProvider adapter={adapter}>
        <HomePage />
      </WalletProvider>
    </I18nProvider>,
  );
}

function balanceSection(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /testnet balance|testnet bakiyesi/i });
  const section = heading.closest('section');
  if (section === null) throw new Error('balance section missing');
  return section;
}

beforeEach(() => {
  readNativeBalance.mockReset();
});

describe('home - disconnected', () => {
  it('offers a connect action and shows no balance digits', async () => {
    renderHome(fakeAdapter());
    const button = await screen.findByRole('button', { name: 'Connect wallet' });
    expect(button).toBeTruthy();
    expect(balanceSection().textContent).not.toMatch(/\d/);
    expect(readNativeBalance).not.toHaveBeenCalled();
  });

  it('does not show the development "what works" cards', async () => {
    renderHome(fakeAdapter());
    await screen.findByRole('button', { name: 'Connect wallet' });
    expect(screen.queryByText(/what works today/i)).toBeNull();
    expect(screen.queryByText(/what does not work yet/i)).toBeNull();
  });

  it('explains a cancelled connection without signing anything', async () => {
    renderHome(fakeAdapter({ connect: async () => Promise.reject(new WalletError('cancelled')) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    expect(await screen.findByText('Connection cancelled')).toBeTruthy();
  });

  it('reports an unavailable wallet list', async () => {
    renderHome(fakeAdapter({ connect: async () => Promise.reject(new Error('Failed to load manifest')) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    expect(await screen.findByText('No wallet available')).toBeTruthy();
  });

  it('renders the disabled state when wallet connection is off', () => {
    renderHome(null);
    expect(screen.getByText('Wallet connection is off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect wallet' })).toBeNull();
  });
});

describe('home - connected', () => {
  it('shows a verified Testnet balance with its final block', async () => {
    readNativeBalance.mockResolvedValue(verified());
    renderHome(fakeAdapter({ restore: async () => SESSION }));
    await waitFor(() => expect(balanceSection().textContent).toContain('1,015,695.9974'));
    expect(balanceSection().textContent).toContain('Final block #275,322,097');
    expect(readNativeBalance).toHaveBeenCalledWith('alice.testnet');
  });

  it('never shows a number for a mock observation', async () => {
    readNativeBalance.mockResolvedValue(verified('mock'));
    renderHome(fakeAdapter({ restore: async () => SESSION }));
    expect(await screen.findByText('Balance not verified')).toBeTruthy();
    expect(balanceSection().textContent).not.toContain('1,015,695');
  });

  it('never turns an RPC failure into a zero balance', async () => {
    readNativeBalance.mockResolvedValue({
      observation: {
        source: 'rpc',
        assurance: 'unknown',
        data: null,
        observedBlock: null,
        checkedAt: '2026-10-29T16:05:00.000Z',
        stale: false,
        rpcAvailable: false,
      },
      error: { code: 'RPC_UNAVAILABLE', messageKey: 'nearClient.errors.RPC_UNAVAILABLE', retry: 'READ_ONLY', providerId: 'p' },
    });
    renderHome(fakeAdapter({ restore: async () => SESSION }));
    expect(await screen.findByText('Balance unavailable')).toBeTruthy();
    expect(balanceSection().textContent).not.toMatch(/\b0\s*NEAR/);
    expect(screen.queryByText(/Final block/)).toBeNull();
  });

  it('explains an account that does not exist on Testnet', async () => {
    readNativeBalance.mockResolvedValue({
      observation: {
        source: 'rpc',
        assurance: 'unknown',
        data: null,
        observedBlock: null,
        checkedAt: '2026-10-29T16:05:00.000Z',
        stale: false,
        rpcAvailable: true,
      },
      error: { code: 'ACCOUNT_NOT_FOUND', messageKey: 'nearClient.errors.ACCOUNT_NOT_FOUND', retry: 'NONE', providerId: 'p' },
    });
    renderHome(fakeAdapter({ restore: async () => ({ ...SESSION, accountId: 'alice.near' }) }));
    expect(await screen.findByText('Account not found on Testnet')).toBeTruthy();
    expect(screen.getByText('This looks like a mainnet account')).toBeTruthy();
  });

  it('drops to disconnected when the wallet signs out', async () => {
    readNativeBalance.mockResolvedValue(verified());
    let emit: (session: WalletSession | null) => void = () => undefined;
    renderHome(
      fakeAdapter({
        restore: async () => SESSION,
        subscribe: (listener) => {
          emit = listener;
          return () => undefined;
        },
      }),
    );
    await waitFor(() => expect(balanceSection().textContent).toContain('1,015,695'));
    act(() => emit(null));
    expect(await screen.findByRole('button', { name: 'Connect wallet' })).toBeTruthy();
    expect(balanceSection().textContent).not.toMatch(/\d/);
  });
});

describe('home - quick actions and activity', () => {
  it('Send says Soon while signing is off; Request opens the real create flow (which explains the gate)', async () => {
    renderHome(fakeAdapter());
    expect(await screen.findByRole('link', { name: 'Send, Soon' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Request' }).getAttribute('href')).toBe('/request/new');
    expect(screen.getByRole('link', { name: 'Receive' })).toBeTruthy();
  });

  it('offers the product tour, clearly as a tour', async () => {
    renderHome(fakeAdapter());
    const tour = await screen.findByRole('link', { name: /See a full payment in 60 seconds/ });
    expect(tour.getAttribute('href')).toBe('/demo');
  });

  it('shows an honest empty activity state instead of invented rows', async () => {
    renderHome(fakeAdapter());
    expect(await screen.findByText('No activity to show yet')).toBeTruthy();
  });
});

describe('home - Turkish locale', () => {
  it('renders the product copy in Turkish', async () => {
    renderHome(fakeAdapter(), 'tr');
    expect(await screen.findByRole('button', { name: 'Cüzdan bağla' })).toBeTruthy();
    expect(screen.getByText('Son hareketler')).toBeTruthy();
    expect(screen.queryByText('Connect wallet')).toBeNull();
  });

  it('formats the balance with Turkish separators', async () => {
    readNativeBalance.mockResolvedValue(verified());
    renderHome(fakeAdapter({ restore: async () => SESSION }), 'tr');
    await waitFor(() => expect(balanceSection().textContent).toContain('1.015.695,9974'));
  });
});
