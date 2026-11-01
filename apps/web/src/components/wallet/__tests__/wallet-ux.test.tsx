import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WalletPage from '@/app/wallet/page';
import { ReceiveCard } from '../ReceiveCard';
import { DemoTour } from '@/components/demo/DemoTour';
import { DEMO_STEPS } from '@/lib/mock/demo-journey';
import { installChain, readySetup, recordingWallet, renderWithChain } from '@/test/chain';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function setup() {
  return readySetup(installChain({ contractId: 'pay.testnet' }), false);
}

describe('/wallet onboarding', () => {
  it('only "Connect existing wallet" works; native options say Not available yet and collect nothing', async () => {
    renderWithChain(<WalletPage />, { setup: setup(), adapter: recordingWallet(null).adapter });
    expect(await screen.findByRole('heading', { name: 'Your wallet. Your payment. One tap.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
    expect(screen.getAllByText('Not available yet')).toHaveLength(2);

    const create = screen.getByRole('button', { name: /Create Taply Wallet/ });
    expect(create.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(create);
    expect(create.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/needs reviewed, secure key storage/)).toBeTruthy();
    // A not-yet-available wallet never asks for a password, phrase or key.
    expect(document.querySelectorAll('input, textarea')).toHaveLength(0);
    // No dead end: the explanation offers the tour.
    expect(screen.getByRole('link', { name: /See the design in the tour/ }).getAttribute('href')).toBe('/demo');
  });

  it('a connected wallet is shown as an external wallet with its keys outside Taply', async () => {
    renderWithChain(<WalletPage />, { setup: setup(), adapter: recordingWallet('alice.testnet').adapter });
    expect(await screen.findByText(/Your keys stay in Fake Wallet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'External wallet' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Taply Wallet' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Account ID (implicit)')).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });
});

describe('ReceiveCard', () => {
  it('encodes exactly the account ID, offers copy and warns about the network', () => {
    renderWithChain(<ReceiveCard accountId="alice.testnet" />, { setup: setup(), adapter: recordingWallet(null).adapter });
    expect(screen.getByRole('img', { name: 'My NEAR Testnet account: alice.testnet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy account ID' })).toBeTruthy();
    expect(screen.getByText('NEAR Testnet only')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ask for an exact amount' }).getAttribute('href')).toBe('/request/new');
  });
});

describe('/demo tour', () => {
  it('every one of the eight steps carries a DEMO marker and the steps are navigable', async () => {
    renderWithChain(<DemoTour />, { setup: setup(), adapter: recordingWallet(null).adapter });
    const nav = screen.getByRole('navigation', { name: 'Tour progress' });
    expect(within(nav).getAllByRole('button')).toHaveLength(DEMO_STEPS.length);
    for (let i = 0; i < DEMO_STEPS.length; i++) {
      fireEvent.click(within(nav).getAllByRole('button')[i] as HTMLElement);
      expect(new URLSearchParams(window.location.search).get('step')).toBe(DEMO_STEPS[i]);
      expect(screen.getAllByText('DEMO').length).toBeGreaterThan(0);
    }
  });

  it('the demo send confirmation is labelled demo and never reaches the wallet', async () => {
    window.history.replaceState(null, '', '/demo?step=send');
    const wallet = recordingWallet('alice.testnet');
    renderWithChain(<DemoTour />, { setup: setup(), adapter: wallet.adapter });
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and send (demo)' }));
    expect(await screen.findByRole('heading', { name: 'Sending' })).toBeTruthy();
    expect(wallet.signed).toEqual([]);
  });
});
