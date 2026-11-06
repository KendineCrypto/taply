import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletBalanceSnapshot, WalletChain } from '@taply/near-client';
import { createTaplyWalletController } from '@/lib/wallet/taply-wallet';
import { installChain, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { CreateWalletFlow } from '../CreateWalletFlow';
import { RestoreWalletFlow } from '../RestoreWalletFlow';
import { TaplySend } from '../TaplySend';
import { TaplyReceive } from '../TaplyReceive';
import { TaplyWalletPanel } from '../TaplyWalletUi';
import { WalletOnboarding } from '../../WalletOnboarding';

/**
 * UI against the REAL Codex controller: real Web Crypto (Ed25519, PBKDF2 600k,
 * AES-GCM) and real vault code. Only the chain reader and Web Locks are
 * deterministic stand-ins. No chain account is created, nothing is signed.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

const PASS = 'correct horse battery staple 42';
const SLOW = { timeout: 20_000 };
const config = { network: 'near-testnet' as const, rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'unit', contract: null };
const controllers: Array<ReturnType<typeof createTaplyWalletController>> = [];

function memory() {
  const values = new Map<string, string>();
  return { values, storage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) } };
}

function controller(provisioned: boolean, storage = memory().storage) {
  const snapshot = vi.fn(async (accountId: string, publicKey: string): Promise<WalletBalanceSnapshot | null> =>
    provisioned
      ? {
          network: 'near-testnet', accountId, publicKey, nonce: '1', blockHash: '1'.repeat(32), blockHeight: '275000000',
          blockTimestampNs: '1793535606670615924', amountYocto: '2000000000000000000000000', storageUsageBytes: '182',
          storageByteCostYocto: '10000000000000000000', gasPriceYocto: '100000000',
        }
      : null,
  );
  const chain: WalletChain = { snapshot, checkNetwork: vi.fn(async () => {}), receiverExists: vi.fn(async () => {}) };
  const c = createTaplyWalletController({ config, storage, crypto: webcrypto as unknown as Crypto, chain });
  controllers.push(c);
  return c;
}

function render(ui: React.ReactElement, c: ReturnType<typeof createTaplyWalletController> | null) {
  const chain = installChain({ contractId: 'pay.testnet' });
  const wallet = recordingWallet(null);
  renderWithChain(ui, { setup: readySetup(chain, false), adapter: wallet.adapter, taply: () => c });
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

describe('create Taply Wallet (real controller)', () => {
  it('gates on acknowledgements and passphrase rules, creates LOCAL ONLY, and requires the encrypted backup', async () => {
    const c = controller(false);
    let blobText = '';
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        void blob.text().then((text) => (blobText = text));
        return 'blob:test';
      },
      revokeObjectURL: () => undefined,
    }));
    render(<CreateWalletFlow />, c);

    const cont = await screen.findByRole('button', { name: /Continue/ });
    expect((cont as HTMLButtonElement).disabled).toBe(true);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(cont);

    const pass = screen.getByLabelText('Passphrase');
    fireEvent.change(pass, { target: { value: 'short' } });
    expect(screen.getByText('Use at least 16 characters.')).toBeTruthy();
    fireEvent.change(pass, { target: { value: PASS } });
    fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: `${PASS}x` } });
    expect(screen.getByText('The passphrases do not match.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Create wallet/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: PASS } });
    expect(screen.getByText(/Strength:/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create wallet/ }));
    });
    expect(await screen.findByText('Wallet created and locked', {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Local only — not on NEAR Testnet')).toBeTruthy(), SLOW);
    expect(screen.queryByText('Active on NEAR Testnet')).toBeNull();
    expect(c.unlocked).toBe(false);

    const finish = screen.getByRole('button', { name: 'Finish' }) as HTMLButtonElement;
    const saved = screen.getByLabelText(/I saved the encrypted backup/) as HTMLInputElement;
    expect(finish.disabled).toBe(true);
    expect(saved.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Download encrypted backup' }));
    await waitFor(() => expect(blobText).not.toBe(''));
    // The file is the encrypted vault record: ciphertext + public metadata, never the passphrase.
    const record = JSON.parse(blobText) as Record<string, unknown>;
    expect(record['cipher']).toBe('AES-256-GCM');
    expect(typeof record['ciphertext']).toBe('string');
    expect(blobText).not.toContain(PASS);
    expect(Object.keys(record).some((k) => /private|secret|seed|mnemonic/i.test(k))).toBe(false);
    expect(finish.disabled).toBe(true);
    fireEvent.click(saved);
    expect(finish.disabled).toBe(false);
  }, 60_000);
});

describe('manage Taply Wallet (real controller)', () => {
  it('local-only identity: no balance, never "active"; wrong passphrase refused; unlock and lock', async () => {
    const c = controller(false);
    const identity = await c.create(PASS);
    render(<TaplyWalletPanel />, c);

    expect(await screen.findByText(identity.accountId, {}, SLOW)).toBeTruthy();
    expect(screen.getByText('Local only — not on NEAR Testnet')).toBeTruthy();
    expect(screen.getByText('No balance: not on NEAR Testnet yet')).toBeTruthy();
    expect(screen.queryByText('Active on NEAR Testnet')).toBeNull();
    expect(screen.getByText('Locked')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'definitely the wrong passphrase' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }));
    });
    expect((await screen.findByRole('alert', {}, SLOW)).textContent).toContain('Wrong passphrase');
    expect(c.unlocked).toBe(false);

    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: PASS } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Unlock$/ }));
    });
    expect(await screen.findByRole('button', { name: /Lock now/ }, SLOW)).toBeTruthy();
    expect(screen.getByText('Unlocked')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Lock now/ }));
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(c.unlocked).toBe(false);
  }, 60_000);

  it('provisioned: verified balance and "Active on NEAR Testnet"', async () => {
    const c = controller(true);
    await c.create(PASS);
    render(<TaplyWalletPanel />, c);
    expect(await screen.findByText('Active on NEAR Testnet', {}, SLOW)).toBeTruthy();
    expect(screen.getByText(/Final block #275,000,000/)).toBeTruthy();
  }, 60_000);

  it('local-only receive shows the exact account QR and says it has no Testnet account yet', async () => {
    const c = controller(false);
    const identity = await c.create(PASS);
    render(<TaplyReceive />, c);
    expect(await screen.findByRole('img', { name: `My NEAR Testnet account: ${identity.accountId}` }, SLOW)).toBeTruthy();
    expect(screen.getByText(/first incoming NEAR Testnet transfer creates the account/)).toBeTruthy();
  }, 60_000);
});

describe('send from Taply Wallet (review only)', () => {
  it('provisioned: exact review with reserves; confirming is disabled and nothing is signed', async () => {
    const c = controller(true);
    await c.create(PASS);
    const wallet = render(<TaplySend />, c);
    fireEvent.change(await screen.findByLabelText('To', {}, SLOW), { target: { value: 'receiver.testnet' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0.1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review/ }));
    });
    expect(await screen.findByRole('heading', { name: 'Review transfer' }, SLOW)).toBeTruthy();
    expect(screen.getByText('receiver.testnet')).toBeTruthy();
    expect(screen.getByText('Gas reserve (not a fee)')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm and send' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/Taply Wallet signing is switched off/)).toBeTruthy();
    expect(wallet.signed).toEqual([]);
  }, 60_000);

  it('rejects an amount beyond the available balance with an accessible error', async () => {
    const c = controller(true);
    await c.create(PASS);
    render(<TaplySend />, c);
    fireEvent.change(await screen.findByLabelText('To', {}, SLOW), { target: { value: 'receiver.testnet' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '5' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review/ }));
    });
    expect((await screen.findByRole('alert', {}, SLOW)).textContent).toContain('More than the available balance');
  }, 60_000);

  it('local-only cannot send and offers the external wallet', async () => {
    const c = controller(false);
    await c.create(PASS);
    render(<TaplySend />, c);
    expect(await screen.findByText('Taply Wallet is not active on NEAR Testnet', {}, SLOW)).toBeTruthy();
    expect(screen.queryByLabelText('Amount')).toBeNull();
  }, 60_000);
});

describe('restore (real controller)', () => {
  it('restores only from the encrypted backup with its passphrase, and stays locked', async () => {
    const source = controller(false);
    const identity = await source.create(PASS);
    const backup = source.exportEncryptedBackup();
    const target = controller(false, memory().storage);
    render(<RestoreWalletFlow />, target);

    fireEvent.change(await screen.findByLabelText('Or paste the backup', {}, SLOW), { target: { value: backup } });
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'not the right passphrase!!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Restore wallet/ }));
    });
    expect((await screen.findByRole('alert', {}, SLOW)).textContent).toContain('Wrong passphrase');

    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: PASS } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Restore wallet/ }));
    });
    await waitFor(async () => expect((await target.read()).status).toBe('LOCAL_ONLY'), SLOW);
    expect(target.receive().identity.accountId).toBe(identity.accountId);
    expect(target.unlocked).toBe(false);
  }, 60_000);
});

describe('unavailable browsers', () => {
  it('without the controller: panel explains, onboarding keeps native options visibly unavailable', async () => {
    render(
      <>
        <TaplyWalletPanel />
        <WalletOnboarding />
      </>,
      null,
    );
    expect(await screen.findByText('Taply Wallet is not available in this browser')).toBeTruthy();
    expect(screen.getAllByText('Not available yet')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
  });

  it('with the controller: onboarding links to the real create and restore flows, marked sending off', async () => {
    const c = controller(false);
    render(<WalletOnboarding />, c);
    expect((await screen.findByRole('link', { name: /Create Taply Wallet/ })).getAttribute('href')).toBe('/wallet/create');
    expect(screen.getByRole('link', { name: /Restore Taply Wallet/ }).getAttribute('href')).toBe('/wallet/restore');
    expect(screen.getAllByText('Testnet · sending off')).toHaveLength(2);
  });
});
