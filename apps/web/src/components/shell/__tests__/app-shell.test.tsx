import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../AppShell';
import { I18nProvider } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import { WalletProvider } from '@/lib/wallet/provider';
import type { WalletAdapter, WalletSession } from '@/lib/wallet/adapter';

/** The one-tap shell: three destinations, the Tap sheet and the account menu. */

const push = vi.fn();
let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));

const SESSION: WalletSession = { accountId: 'alice.testnet', walletId: 'fake', walletName: 'Fake Wallet' };
const ID = 'ab'.repeat(32);

function adapter(session: WalletSession | null): WalletAdapter {
  return {
    restore: async () => session,
    connect: async () => SESSION,
    disconnect: async () => undefined,
    subscribe: () => () => undefined,
    signAndSendTransaction: async () => {
      throw new Error('the shell must never sign');
    },
  };
}

function renderShell(locale: Locale = 'en', session: WalletSession | null = null) {
  return render(
    <I18nProvider locale={locale}>
      <WalletProvider adapter={adapter(session)}>
        <AppShell>
          <p>content</p>
        </AppShell>
      </WalletProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  pathname = '/';
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('one-tap navigation', () => {
  it('has exactly three persistent destinations: Wallet, Tap and Activity', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(nav).getByRole('link', { name: 'Wallet' }).getAttribute('href')).toBe('/');
    expect(within(nav).getByRole('link', { name: 'Activity' }).getAttribute('href')).toBe('/activity');
    expect(within(nav).getByRole('button', { name: 'Tap' })).toBeTruthy();
    // Settings, Pay hub and Scan are no longer bottom tabs.
    expect(within(nav).queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Scan' })).toBeNull();
  });

  it('marks the current tab', () => {
    pathname = '/activity';
    renderShell();
    expect(screen.getByRole('link', { name: 'Activity' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Wallet' }).getAttribute('aria-current')).toBeNull();
  });

  it('always shows the NEAR Testnet badge', () => {
    renderShell();
    expect(screen.getByText('NEAR Testnet')).toBeTruthy();
  });

  it('localizes the navigation in Turkish', () => {
    renderShell('tr');
    expect(screen.getByRole('link', { name: 'Cüzdan' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Geçmiş' })).toBeTruthy();
  });
});

describe('Tap sheet', () => {
  function openTap() {
    fireEvent.click(screen.getByRole('button', { name: 'Tap' }));
    return screen.getByRole('dialog', { name: 'What would you like to do?' });
  }

  it('offers Request first, then Pay and Send, and navigates only on a choice', () => {
    renderShell();
    const tap = screen.getByRole('button', { name: 'Tap' });
    expect(tap.getAttribute('aria-expanded')).toBe('false');
    const sheet = openTap();
    expect(tap.getAttribute('aria-expanded')).toBe('true');
    const actions = within(sheet).getAllByRole('button').filter((b) => b.getAttribute('aria-label') === null);
    expect(actions.map((b) => within(b).getAllByText(/./)[0]?.textContent)).toEqual(['Request', 'Pay', 'Send NEAR']);
    // Sending is honestly labelled as a preview.
    expect(within(sheet).getByText(/Preview only: confirming a transfer is not available yet/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByText('Request'));
    expect(push).toHaveBeenCalledWith('/request/new');
  });

  it('closes with the close button and with Escape, without navigating', async () => {
    renderShell();
    let sheet = openTap();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    sheet = openTap();
    fireEvent(sheet, new Event('cancel', { cancelable: true }));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('opens a pasted payment link on this app’s own /pay page, never the pasted host', () => {
    renderShell();
    const sheet = openTap();
    fireEvent.click(within(sheet).getByText('Pay'));
    const field = screen.getByLabelText('Payment link');
    fireEvent.change(field, { target: { value: 'https://example.org/not-a-payment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open payment' }));
    expect(screen.getByRole('alert').textContent).toBe('This is not a Taply payment link.');
    expect(push).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: `https://elsewhere.example/pay/${ID}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Open payment' }));
    expect(push).toHaveBeenCalledWith(`/pay/${ID}`);
  });
});

describe('account menu', () => {
  it('holds wallet, receive, settings, help and language, and shows the active wallet kind', async () => {
    renderShell('en', SESSION);
    const avatar = await screen.findByRole('button', { name: 'Account and settings: alice.testnet' });
    fireEvent.click(avatar);
    const sheet = screen.getByRole('dialog', { name: 'Account' });
    expect(within(sheet).getByText('alice.testnet')).toBeTruthy();
    expect(within(sheet).getByText('External wallet')).toBeTruthy();
    for (const label of ['Wallet and account', 'Receive: address and QR code', 'Settings', 'Help and product tour']) {
      expect(within(sheet).getByText(label)).toBeTruthy();
    }
    expect(within(sheet).getByRole('button', { name: 'Türkçe' })).toBeTruthy();
    fireEvent.click(within(sheet).getByText('Help and product tour'));
    expect(push).toHaveBeenCalledWith('/demo');
  });

  it('says plainly when no wallet is connected', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Account and settings' }));
    expect(screen.getByText('No wallet connected')).toBeTruthy();
  });
});
