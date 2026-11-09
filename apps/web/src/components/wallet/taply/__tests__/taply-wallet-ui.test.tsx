import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalletBalanceSnapshot, WalletChain } from '@taply/near-client';
import { createTaplyWalletController } from '@/lib/wallet/taply-wallet';
import type { FaucetResult } from '@/lib/wallet/testnet-account';
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
  const chain: WalletChain = { snapshot, checkNetwork: vi.fn(async () => {}), receiverExists: vi.fn(async () => {}),
    accountExists: vi.fn(async () => provisioned), provisioning: vi.fn(async () => (provisioned ? 'ON_CHAIN' as const : 'ACCOUNT_NOT_FOUND' as const)) };
  const c = createTaplyWalletController({ config, storage, crypto: webcrypto as unknown as Crypto, chain });
  controllers.push(c);
  return c;
}

/**
 * Stateful stand-in for NEAR Testnet: names in `taken` exist under another key;
 * the faucet stub decides whether our named account appears. FINAL reads
 * (accountExists/provisioning/snapshot) only report what this state holds.
 */
function namedController(faucet: (accountId: string, publicKey: string, chain: { created: Set<string> }) => Promise<FaucetResult>, taken = ['taken.testnet']) {
  const state = { created: new Set<string>() };
  const balance = (accountId: string, publicKey: string): WalletBalanceSnapshot => ({
    network: 'near-testnet', accountId, publicKey, nonce: '1', blockHash: '1'.repeat(32), blockHeight: '275000000',
    blockTimestampNs: '1793535606670615924', amountYocto: '10000000000000000000000000', storageUsageBytes: '182',
    storageByteCostYocto: '10000000000000000000', gasPriceYocto: '100000000',
  });
  const chain: WalletChain = {
    checkNetwork: vi.fn(async () => {}),
    receiverExists: vi.fn(async () => {}),
    accountExists: vi.fn(async (id: string) => taken.includes(id) || state.created.has(id)),
    provisioning: vi.fn(async (id: string) => (state.created.has(id) ? 'ON_CHAIN' as const : taken.includes(id) ? 'KEY_NOT_ON_ACCOUNT' as const : 'ACCOUNT_NOT_FOUND' as const)),
    snapshot: vi.fn(async (id: string, key: string) => {
      if (state.created.has(id)) return balance(id, key);
      if (taken.includes(id)) throw new Error('UNKNOWN_ACCESS_KEY');
      return null;
    }),
  };
  const requestAccount = vi.fn((accountId: string, publicKey: string) => faucet(accountId, publicKey, state));
  const c = createTaplyWalletController({ config, storage: memory().storage, crypto: webcrypto as unknown as Crypto, chain, requestAccount, sleep: async () => {} });
  controllers.push(c);
  return { c, requestAccount, state, chain };
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

describe('create Taply Wallet = username.testnet (real controller, stubbed Testnet)', () => {
  it('username + FINAL availability, password, 12-word phrase (no backup file), then faucet and on-chain proof', async () => {
    const { c, requestAccount } = namedController(async (accountId, _key, chain) => {
      chain.created.add(accountId);
      return { ok: true };
    });
    const createObjectURL = vi.fn(() => 'blob:test');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: () => undefined }));
    const clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    render(<CreateWalletFlow />, c);

    const cont = await screen.findByRole('button', { name: /Continue/ });
    expect((cont as HTMLButtonElement).disabled).toBe(true);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(cont);

    // Step 2: username.
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    const name = screen.getByLabelText('Username');
    fireEvent.change(name, { target: { value: 'bad__name' } });
    expect(screen.getByText('- and _ must sit between letters or numbers.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'Taken.testnet' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    });
    expect(await screen.findByText('taken.testnet is already taken.')).toBeTruthy();
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'alice' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    });

    // Step 3: password (8+ chars), bound to the chosen name.
    expect(await screen.findByText('Step 3 of 4')).toBeTruthy();
    expect(screen.getByText('alice.testnet')).toBeTruthy();
    const pass = screen.getByLabelText('Password');
    fireEvent.change(pass, { target: { value: 'short' } });
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
    fireEvent.change(pass, { target: { value: PASS } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: `${PASS}x` } });
    expect(screen.getByText('The passwords do not match.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Create wallet/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASS } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create wallet/ }));
    });

    // Step 4a: Secret Recovery Phrase, hidden until tapped; nothing on chain yet.
    expect(await screen.findByRole('heading', { name: 'Your Secret Recovery Phrase' }, SLOW)).toBeTruthy();
    expect(requestAccount).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Download encrypted backup/ })).toBeNull();
    const words = await c.revealRecoveryPhrase(PASS);
    expect(words).toHaveLength(12);
    expect(screen.queryByText(words[0] ?? "missing")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tap to reveal' }));
    const list = screen.getByRole('list', { name: 'Your Secret Recovery Phrase' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(words.map((w, i) => `${i + 1}${w}`));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(words.join(' '));
    const next = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I saved my Secret Recovery Phrase'));
    await act(async () => {
      fireEvent.click(next);
    });

    // Step 4b: faucet + FINAL proof.
    expect(await screen.findByText('alice.testnet is live on NEAR Testnet', {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Active on NEAR Testnet')).toBeTruthy(), SLOW);
    expect(requestAccount).toHaveBeenCalledTimes(1);
    expect(requestAccount.mock.calls[0]?.[0]).toBe('alice.testnet');
    expect(requestAccount.mock.calls[0]?.[1]).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(c.unlocked).toBe(false);
    expect(c.receive().identity).toMatchObject({ accountId: 'alice.testnet', recovery: 'RECOVERY_PHRASE' });
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(words.join(' '));
  }, 60_000);

  it('faucet rate limit: keeps the local vault, never claims the account, retry succeeds', async () => {
    let allow = false;
    const { c, requestAccount } = namedController(async (accountId, _key, chain) => {
      if (!allow) return { ok: false, reason: 'rate_limited' };
      chain.created.add(accountId);
      return { ok: true };
    });
    await c.createNamed(PASS, 'bob.testnet');
    render(<TaplyWalletPanel />, c);
    const setup = await screen.findByRole('button', { name: /Finish account setup/ }, SLOW);
    await act(async () => {
      fireEvent.click(setup);
    });
    expect(await screen.findByText('Not on NEAR Testnet yet', {}, SLOW)).toBeTruthy();
    expect(screen.getByText(/faucet is busy/)).toBeTruthy();
    expect(screen.getByText(/no account was confirmed on NEAR Testnet/)).toBeTruthy();
    expect(screen.queryByText('Active on NEAR Testnet')).toBeNull();
    expect((await c.read()).status).toBe('LOCAL_ONLY');
    allow = true;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    });
    expect(await screen.findByText('Active on NEAR Testnet', {}, SLOW)).toBeTruthy();
    expect(requestAccount).toHaveBeenCalledTimes(2);
  }, 60_000);

  it('name taken under another key: says so, then rebinds the same key to a new name with the passphrase', async () => {
    const { c, requestAccount } = namedController(async (accountId, _key, chain) => {
      if (accountId === 'taken.testnet') return { ok: false, reason: 'rejected' };
      chain.created.add(accountId);
      return { ok: true };
    });
    const first = await c.createNamed(PASS, 'taken.testnet');
    render(<TaplyWalletPanel />, c);
    expect(await screen.findByText('Name owned by another key', {}, SLOW)).toBeTruthy();
    expect(screen.getByText('That username is already taken on NEAR Testnet. Choose another one.')).toBeTruthy();
    const form = screen.getByRole('heading', { name: 'Choose another username' }).closest('section') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('Username'), { target: { value: 'carol' } });
    fireEvent.change(within(form).getByLabelText('Password'), { target: { value: PASS } });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: /Use this username/ }));
    });
    expect(await screen.findByText('Active on NEAR Testnet', {}, SLOW)).toBeTruthy();
    expect(c.receive().identity.accountId).toBe('carol.testnet');
    expect(c.receive().identity.publicKeyHex).toBe(first.publicKeyHex);
    expect(requestAccount).toHaveBeenCalledTimes(1);
    expect(requestAccount.mock.calls[0]?.[0]).toBe('carol.testnet');
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
    // A pre-username (implicit) wallet is offered a username, never shown as active.
    expect(screen.getByRole('heading', { name: 'Choose another username' })).toBeTruthy();

    const unlock = within(screen.getByRole('form', { name: 'Unlock Taply Wallet' }));
    fireEvent.change(unlock.getByLabelText('Password'), { target: { value: 'definitely the wrong passphrase' } });
    await act(async () => {
      fireEvent.click(unlock.getByRole('button', { name: /^Unlock$/ }));
    });
    expect((await unlock.findByRole('alert', {}, SLOW)).textContent).toContain('Wrong password');
    expect(c.unlocked).toBe(false);

    fireEvent.change(unlock.getByLabelText('Password'), { target: { value: PASS } });
    await act(async () => {
      fireEvent.click(unlock.getByRole('button', { name: /^Unlock$/ }));
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

  it('named but unconfirmed receive never says a transfer creates it and links to finishing setup', async () => {
    const { c } = namedController(async () => ({ ok: false, reason: 'unavailable' }));
    await c.createNamed(PASS, 'dave.testnet');
    render(<TaplyReceive />, c);
    expect(await screen.findByRole('img', { name: 'My NEAR Testnet account: dave.testnet' }, SLOW)).toBeTruthy();
    expect(screen.getByText(/not confirmed on NEAR Testnet yet/)).toBeTruthy();
    expect(screen.queryByText(/first incoming NEAR Testnet transfer creates the account/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Finish account setup' }).getAttribute('href')).toBe('/wallet');
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

describe('recovery phrase (Phantom-style, real controller)', () => {
  const VECTOR = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

  it('/wallet shows the 12 words only after the password and keeps them hidden until tapped', async () => {
    const { c, state } = namedController(async () => ({ ok: true }));
    const identity = await c.createNamed(PASS, 'erin.testnet');
    state.created.add('erin.testnet');
    render(<TaplyWalletPanel />, c);
    const section = within((await screen.findByRole('heading', { name: 'Show recovery phrase' }, SLOW)).closest('section') as HTMLElement);
    expect(screen.queryByRole('button', { name: /Download encrypted backup/ })).toBeNull();
    fireEvent.change(section.getByLabelText('Password'), { target: { value: 'definitely the wrong one' } });
    await act(async () => {
      fireEvent.click(section.getByRole('button', { name: 'Show phrase' }));
    });
    expect((await section.findByRole('alert', {}, SLOW)).textContent).toContain('Wrong password');
    fireEvent.change(section.getByLabelText('Password'), { target: { value: PASS } });
    await act(async () => {
      fireEvent.click(section.getByRole('button', { name: 'Show phrase' }));
    });
    const reveal = await section.findByRole('button', { name: 'Tap to reveal' }, SLOW);
    const words = await c.revealRecoveryPhrase(PASS);
    expect(section.queryByText(words[0] ?? "missing")).toBeNull();
    fireEvent.click(reveal);
    expect(section.getAllByRole('listitem')).toHaveLength(12);
    expect(section.getByText(words[11] ?? "missing")).toBeTruthy();
    expect(c.unlocked).toBe(false);
    expect(c.receive().identity.publicKeyHex).toBe(identity.publicKeyHex);
  }, 60_000);

  it('import: checks on chain that the phrase controls the account before storing anything', async () => {
    const { c, state } = namedController(async () => ({ ok: true }), ['someone-else.testnet']);
    render(<RestoreWalletFlow />, c);
    const phrase = await screen.findByLabelText('Recovery phrase', {}, SLOW);
    fireEvent.change(phrase, { target: { value: 'abandon abandon abandon' } });
    expect(screen.getByText('3 / 12 words')).toBeTruthy();
    const submit = screen.getByRole('button', { name: /Import wallet/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(phrase, { target: { value: VECTOR } });
    fireEvent.change(screen.getByLabelText('Your account (username.testnet)'), { target: { value: 'someone-else' } });
    fireEvent.change(screen.getByLabelText('Create a password for this device'), { target: { value: PASS } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASS } });
    await act(async () => {
      fireEvent.click(submit);
    });
    expect((await screen.findByRole('alert', {}, SLOW)).textContent).toContain('does not control that account');
    expect((await c.read()).status).toBe('NOT_CREATED');

    fireEvent.change(screen.getByLabelText('Your account (username.testnet)'), { target: { value: 'nobody' } });
    await act(async () => {
      fireEvent.click(submit);
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('does not exist on NEAR Testnet'), SLOW);

    state.created.add('frank.testnet');
    fireEvent.change(screen.getByLabelText('Your account (username.testnet)'), { target: { value: 'frank' } });
    await act(async () => {
      fireEvent.click(submit);
    });
    await waitFor(async () => expect((await c.read()).status).toBe('PROVISIONED'), SLOW);
    expect(c.receive().identity).toMatchObject({ accountId: 'frank.testnet', recovery: 'RECOVERY_PHRASE' });
    expect((await c.revealRecoveryPhrase(PASS)).join(' ')).toBe(VECTOR);
    expect(c.unlocked).toBe(false);
  }, 60_000);
});

describe('restore (real controller)', () => {
  it('legacy: still restores from an older encrypted backup file with its password, and stays locked', async () => {
    const source = controller(false);
    const identity = await source.create(PASS);
    const backup = source.exportEncryptedBackup();
    const target = controller(false, memory().storage);
    render(<RestoreWalletFlow />, target);

    fireEvent.change(await screen.findByLabelText('Or paste the backup', {}, SLOW), { target: { value: backup } });
    const legacy = within(screen.getByText('Restore from an older backup file').closest('details') as HTMLElement);
    fireEvent.change(legacy.getByLabelText('Password'), { target: { value: 'not the right passphrase!!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Restore wallet/ }));
    });
    expect((await legacy.findByRole('alert', {}, SLOW)).textContent).toContain('Wrong password');

    fireEvent.change(legacy.getByLabelText('Password'), { target: { value: PASS } });
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
