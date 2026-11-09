import { webcrypto } from 'node:crypto';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletChain } from '@taply/near-client';
import { createTaplyWalletController } from '@/lib/wallet/taply-wallet';
import { WALLET_MODE_KEY } from '@/components/wallet/taply/mode';
import { installChain, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import HomePage from '../page';

/**
 * First launch on `/` (owner decision 2026-11-09): with no connected wallet and
 * no Taply Wallet on this device, exactly two ways to start are offered.
 * Fake chain + real vault code; nothing reaches NEAR or the faucet.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }));

const config = { network: 'near-testnet' as const, rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'unit', contract: null };
const controllers: Array<ReturnType<typeof createTaplyWalletController>> = [];

function controller() {
  const values = new Map<string, string>();
  const chain: WalletChain = {
    checkNetwork: vi.fn(async () => {}), receiverExists: vi.fn(async () => {}), snapshot: vi.fn(async () => null),
    accountExists: vi.fn(async () => false), provisioning: vi.fn(async () => 'ACCOUNT_NOT_FOUND' as const),
  };
  const requestAccount = vi.fn(async () => ({ ok: true as const }));
  const c = createTaplyWalletController({ config, storage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => void values.set(k, v) },
    crypto: webcrypto as unknown as Crypto, chain, requestAccount });
  controllers.push(c);
  return { c, requestAccount };
}

function renderHome(c: ReturnType<typeof createTaplyWalletController> | null, locale: 'en' | 'tr' = 'en') {
  const chain = installChain({ contractId: 'pay.testnet' });
  const wallet = recordingWallet(null);
  renderWithChain(<HomePage />, { setup: readySetup(chain, false), adapter: wallet.adapter, taply: () => c, locale });
  return wallet;
}

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_n: string, _o: unknown, task: () => Promise<unknown>) => task() },
  });
});

afterEach(() => {
  cleanup();
  for (const c of controllers) c.dispose();
  controllers.length = 0;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('first launch chooser on /', () => {
  it('offers exactly: connect an external wallet, or create a username.testnet Taply Wallet (no sponsored gas)', async () => {
    const { c, requestAccount } = controller();
    renderHome(c);
    expect(await screen.findByRole('heading', { name: 'Welcome to Taply' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Connect an existing wallet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Create a Taply Wallet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Choose a username/ }).getAttribute('href')).toBe('/wallet/create');
    expect(screen.getByText(/there is no sponsored gas/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /I have a Taply Wallet backup/ }).getAttribute('href')).toBe('/wallet/restore');
    // Nothing is created or requested just by showing the choice.
    expect(requestAccount).not.toHaveBeenCalled();
    expect((await c.read()).status).toBe('NOT_CREATED');
  });

  it('renders in Turkish', async () => {
    const { c } = controller();
    renderHome(c, 'tr');
    expect(await screen.findByRole('heading', { name: 'Taply’a hoş geldiniz' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mevcut bir cüzdanı bağla' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Taply Cüzdan oluştur' })).toBeTruthy();
  });

  it('is not shown once a Taply Wallet exists on this device', async () => {
    const { c } = controller();
    await c.createNamed('correct horse battery staple 42', 'alice.testnet');
    window.localStorage.setItem(WALLET_MODE_KEY, 'external');
    renderHome(c);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Welcome to Taply' })).toBeNull();
  }, 30_000);

  it('is not shown when the browser cannot run Taply Wallet (unknown device state)', async () => {
    renderHome(null);
    await screen.findByRole('button', { name: 'Connect wallet' });
    expect(screen.queryByRole('heading', { name: 'Welcome to Taply' })).toBeNull();
  });
});
