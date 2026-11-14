/**
 * Visual parity fixtures (Testnet vs NEAR Mainnet) for states the real app cannot reach
 * without a funded, unlocked key: unlocked Taply Wallet, Send review, filled contacts and
 * activity, the real request form, gift steps 2–4.
 *
 * The REAL page components render with mocked, non-signing providers (every sign/send
 * mock throws). States are reached by filling and submitting the forms. Each fragment is
 * written as HTML; scripts in docs/evidence place it in the running app shell for the
 * screenshot. No key, wallet, recovery phrase, RPC or transaction is involved.
 *
 * Runs only with TAPLY_VISUAL_OUT=<dir>; skipped in normal test runs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toBaseUnits } from '@/lib/format/amount';

const OUT = process.env['TAPLY_VISUAL_OUT'];
const HASH = '9vYr1bZp3c5o7P1QkNq3Y2mZ8r4tF6uW1xA5bC7dE9fG';
const NOW_NS = String(BigInt(Date.now()) * 1_000_000n);
const never = async () => { throw new Error('visual fixture never signs'); };

const S = vi.hoisted(() => ({
  taply: null as unknown,
  mode: 'taply' as 'taply' | 'external',
  wallet: { status: 'connected', session: { accountId: 'alice.testnet', walletName: 'QA wallet (read-only)' } } as unknown,
  payments: null as unknown,
  mw: { status: 'connected', accountId: 'alice.near', walletName: 'QA wallet (read-only)', error: null, publicKey: null, signerWallet: () => null, connect: async () => {}, disconnect: async () => {} } as unknown,
  vault: { identity: null as unknown, unlocked: true },
  activation: null as unknown,
  op: { signer: null as unknown, initial: null as unknown, next: null as unknown, sticky: false },
  local: null as unknown,
  config: null as unknown,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/wallet/taply/TaplyWalletProvider', () => ({ useTaplyWallet: () => S.taply, useOptionalTaplyWallet: () => S.taply }));
vi.mock('@/components/wallet/taply/mode', () => ({ useWalletMode: () => [S.mode, () => {}] }));
vi.mock('@/lib/wallet/provider', () => ({
  useWallet: () => ({ state: S.wallet, signAndSend: never, connect: async () => {}, disconnect: async () => {} }),
  useAccountId: () => (S.wallet as { session?: { accountId: string } }).session?.accountId ?? null,
}));
vi.mock('@/lib/payments/context', () => ({ usePayments: () => S.payments }));
vi.mock('@/lib/flags/features', async (orig) => {
  const real = (await orig()) as { FLAGS: Record<string, unknown> } & Record<string, unknown>;
  const on = { enabled: true, reason: 'enabled' };
  return { ...real, FLAGS: { ...real.FLAGS, gift: on, contacts: on, splitPay: on, recurring: on } };
});
vi.mock('@/lib/mainnet/wallet', () => ({ useMainnetWallet: () => S.mw }));
// jsdom has no IndexedDB: the durable attempt journal is mocked as "no pending attempt".
vi.mock('@taply/near-client', async (orig) => ({ ...((await orig()) as Record<string, unknown>), openMainnetAttemptStore: async () => ({ close: () => {} }), createMainnetAttemptJournal: () => ({ read: async () => null }) }));
vi.mock('@/lib/mainnet/config', () => ({ get MAINNET_CONFIG() { return S.config; } }));
vi.mock('@/lib/mainnet/use-product', () => ({ useLocalProduct: () => S.local }));
vi.mock('@/components/mainnet/Wallet', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    useMainnetVault: () => S.vault,
    useActivation: () => S.activation,
    useUnresolvedAttempt: () => 'none',
    useAttemptRecord: () => ({ status: 'none', attempt: null }),
  };
});
vi.mock('@/components/mainnet/MainnetBalance', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, useMainnetBalance: () => ({ kind: 'ok', native: '12345600000000000000000000', locked: '0', usdc: '42500000', blockHash: HASH, timestampNs: NOW_NS }) };
});
vi.mock('@/components/mainnet/Operation', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    LedgerPanel: () => null,
    useSigner: () => S.op.signer,
    useOperation: () => {
      const [prepared, setPrepared] = useState<unknown>(S.op.initial);
      return {
        signer: S.op.signer, prepared, busy: false, error: '',
        run: async () => { setPrepared(S.op.next); return S.op.next; },
        reset: () => { if (!S.op.sticky) setPrepared(null); },
      };
    },
  };
});

const { I18nProvider: TestnetI18n } = await import('@/lib/i18n/testnet-provider');
const { I18nProvider } = await import('@/lib/i18n/provider');
const { MAINNET_DICTIONARIES } = await import('@/lib/i18n/mainnet-dictionaries');
const { MainnetLocaleProvider } = await import('@/lib/mainnet/copy');

const testnet = (node: ReactNode) => <TestnetI18n locale="en">{node}</TestnetI18n>;
const mainnet = (node: ReactNode) => <I18nProvider locale="en" dictionaries={MAINNET_DICTIONARIES}><MainnetLocaleProvider locale="en">{node}</MainnetLocaleProvider></I18nProvider>;
const save = (name: string, side: 'testnet' | 'mainnet') => {
  if (OUT === undefined) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}-${side}.html`), document.body.firstElementChild?.innerHTML ?? '');
};

// ---------- fixture data (labelled, synthetic) ----------
const testnetIdentity = { network: 'near-testnet', accountId: 'fixture-wallet.testnet', publicKeyHex: 'f'.repeat(63) + 'e', provisioning: 'ON_CHAIN', recovery: 'RECOVERY_PHRASE' };
const testnetBalance = { amountYocto: '12345600000000000000000000', blockTimestampNs: NOW_NS, blockHeight: '200000000' };
const taplyProvisioned = (extra: Record<string, unknown> = {}) => ({
  state: { status: 'provisioned', identity: testnetIdentity, balance: testnetBalance },
  unlocked: true, lock: () => {}, unlock: never, refresh: () => {}, revealPhrase: never, exportEncryptedBackup: never, sendNear: never,
  prepareSend: async (receiverId: string, amountNear: string) => ({ ok: true, value: { receiverId, depositYocto: toBaseUnits(amountNear, 24), availableYocto: '12284100000000000000000000', storageReserveYocto: '50000000000000000000000', gasReserveYocto: '11500000000000000000000' } }),
  ...extra,
});
const mainnetIdentity = { network: 'near-mainnet', accountId: 'fixture-wallet.near', publicKeyHex: 'f'.repeat(63) + 'e', provisioning: 'ON_CHAIN', recovery: 'RECOVERY_PHRASE' };
const snapshot = { network: 'near-mainnet', accountId: 'fixture-wallet.near', publicKey: 'ed25519:8hSHprDq2StXwMtNd43wDTXQYsjXcD4MJTXQYsjXcc', nonce: '7', blockHash: HASH, blockHeight: '200000000', blockTimestampNs: NOW_NS, amountYocto: '12345600000000000000000000', storageUsageBytes: '500', storageByteCostYocto: '10000000000000000000', gasPriceYocto: '100000000' };
const internalSigner = { kind: 'ok', accountId: 'fixture-wallet.near', signer: { kind: 'internal', vault: null } };
const review = (receiverId: string, depositYocto: string) => ({
  review: { id: 'fixture-op', network: 'near-mainnet', accountId: 'fixture-wallet.near', publicKey: snapshot.publicKey, receiverId, action: { kind: 'transfer', depositYocto },
    operationHash: 'a'.repeat(64), nonce: '8', minimumNonce: '8', blockHash: HASH, blockHeight: '200000000', gasReserveYocto: '11500000000000000000000', storageReserveYocto: '50000000000000000000000', expiresAtMs: Date.now() + 110_000 },
  authority: 'device', submit: never,
});
const configBase = {
  ok: true, network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear-mainnet', explorerBaseUrl: 'https://nearblocks.io',
  contract: { status: 'configured', accountId: 'taply-pay.kendinecrypto.near', expectedCodeHash: '9VpaiMp3Hoq8pVVvCW6oSZrvzBdZoNNgUmLCXrm32wX6' },
  profile: { network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.fastnear.com', rpcProviderId: 'fastnear-mainnet', contract: { accountId: 'taply-pay.kendinecrypto.near', expectedCodeHash: '9VpaiMp3Hoq8pVVvCW6oSZrvzBdZoNNgUmLCXrm32wX6' } },
  shareOrigin: null, fixtures: false, signingEnabled: true,
};

afterEach(() => { cleanup(); localStorage.clear(); });

describe.skipIf(OUT === undefined)('visual parity fixtures', () => {
  it('unlocked Taply Wallet page', async () => {
    S.taply = taplyProvisioned();
    const { default: WalletPage } = await import('@/app/wallet/page');
    render(testnet(<WalletPage />));
    save('31-wallet-unlocked', 'testnet');
    cleanup();
    S.config = configBase; S.vault = { identity: mainnetIdentity, unlocked: true }; S.activation = { kind: 'active', snapshot, usdc: '42500000' };
    S.mw = { ...(S.mw as object), status: 'idle', accountId: null };
    const { MainnetWalletPage } = await import('@/components/mainnet/MainnetWalletPage');
    render(mainnet(<MainnetWalletPage />));
    expect(screen.getByTestId('show-phrase')).toBeTruthy();
    save('31-wallet-unlocked', 'mainnet');
  });

  it('Send review (Taply Wallet, 0.25 NEAR to bob)', async () => {
    S.taply = taplyProvisioned();
    const { default: SendPage } = await import('@/app/send/page');
    render(testnet(<SendPage />));
    const inputs = document.querySelectorAll('form input');
    fireEvent.change(inputs[0]!, { target: { value: 'bob.testnet' } });
    fireEvent.change(inputs[1]!, { target: { value: '0.25' } });
    await act(async () => { fireEvent.submit(document.querySelector('form')!); });
    await waitFor(() => expect(document.getElementById('send-review-title')).toBeTruthy());
    save('32-send-review', 'testnet');
    cleanup();
    S.config = configBase; S.vault = { identity: mainnetIdentity, unlocked: true };
    // External-wallet signer: the vault unlock state is read inside Wallet.tsx itself, which a module mock
    // cannot reach; the review card is the same for both signers.
    S.op = { signer: { kind: 'ok', accountId: 'alice.near', signer: { kind: 'near-connect' } }, initial: null, next: { ...review('bob.near', '250000000000000000000000'), review: { ...review('bob.near', '250000000000000000000000').review, accountId: 'alice.near' } }, sticky: false };
    const { MainnetProduct } = await import('@/components/mainnet/MainnetProduct');
    render(mainnet(<MainnetProduct path="send" />));
    fireEvent.change(document.getElementById('mw-to')!, { target: { value: 'bob.near' } });
    fireEvent.change(document.getElementById('mw-amount')!, { target: { value: '0.25' } });
    await act(async () => { fireEvent.submit(document.getElementById('mw-to')!.closest('form')!); });
    await waitFor(() => expect(screen.getByTestId('op-review')).toBeTruthy());
    save('32-send-review', 'mainnet');
  });

  it('filled contacts', async () => {
    const at = new Date().toISOString();
    localStorage.setItem('taply.contacts.v1', JSON.stringify({ version: 1, contacts: [
      { id: 'contact-0001', label: 'Bob', accountId: 'bob.testnet', createdAt: at, updatedAt: at },
      { id: 'contact-0002', label: 'Coffee Corner', accountId: 'coffee-corner.testnet', createdAt: at, updatedAt: at },
      { id: 'contact-0003', label: 'Deniz', accountId: 'deniz.testnet', createdAt: at, updatedAt: at },
    ] }));
    const { default: ContactsPage } = await import('@/app/contacts/page');
    render(testnet(<ContactsPage />));
    await waitFor(() => expect(screen.getAllByTestId('contact-row')).toHaveLength(3));
    save('33-contacts-filled', 'testnet');
    cleanup();
    S.config = configBase; S.mw = { ...(S.mw as object), status: 'connected', accountId: 'alice.near' }; S.vault = { identity: null, unlocked: false };
    S.local = { ready: true, message: '', save: () => {}, data: { contacts: [{ id: 'bob.near', label: 'Bob' }, { id: 'coffee-corner.near', label: 'Coffee Corner' }, { id: 'deniz.near', label: 'Deniz' }], drafts: [], requests: [] } };
    const { MainnetProduct } = await import('@/components/mainnet/MainnetProduct');
    render(mainnet(<MainnetProduct path="contacts" />));
    expect(screen.getAllByTestId('contact-row')).toHaveLength(3);
    save('33-contacts-filled', 'mainnet');
  });

  it('filled activity', async () => {
    const terms = (amount: string) => ({ amountBaseUnits: amount });
    const entry = (i: number, method: string, phase: string, amount: string, minutesAgo: number) => ({
      method, network: 'near-testnet', contractId: 'taply-pay-pilot-1.testnet', requestId: String(i).repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, 'a'),
      termsHash: 'b'.repeat(64), signerAccountId: 'alice.testnet', terms: terms(amount), operationNonce: null, phase,
      transactionHash: null, startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), updatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    });
    const entries = [entry(1, 'create_request', 'RESOLVED', '2500000000000000000000000', 5), entry(2, 'pay_instant_native', 'RESOLVED', '1000000000000000000000000', 60), entry(3, 'create_request', 'SUBMITTED', '750000000000000000000000', 180)];
    S.payments = { journal: { isReadable: () => true, entries: () => entries }, journalVersion: 0 };
    const { default: ActivityPage } = await import('@/app/activity/page');
    render(testnet(<ActivityPage />));
    await waitFor(() => expect(screen.getAllByTestId('activity-row').length).toBe(3));
    save('34-activity-filled', 'testnet');
    cleanup();
    const { fixtureRequests } = await import('@/lib/mainnet/fixtures');
    const fx = fixtureRequests(Date.now());
    const pick = ['usdc-recorded', 'native-awaiting', 'usdc-processing'].map((n) => fx.find((f) => f.scenario.name === n)!.request.terms.id);
    S.config = { ...configBase, fixtures: true }; S.mw = { ...(S.mw as object), status: 'connected', accountId: 'taply-fixture-merchant.near' };
    S.local = { ready: true, message: '', save: () => {}, data: { contacts: [], drafts: [], requests: pick } };
    const { MainnetProduct } = await import('@/components/mainnet/MainnetProduct');
    render(mainnet(<MainnetProduct path="activity" />));
    await waitFor(() => expect(screen.getAllByTestId('activity-row').length).toBe(3));
    await waitFor(() => expect(screen.getAllByTestId('activity-state').every((e) => e.textContent !== '—')).toBe(true));
    save('34-activity-filled', 'mainnet');
  });

  it('request form (payments set up on both)', async () => {
    S.payments = {
      setup: { status: 'ready', contractId: 'taply-pay-pilot-1.testnet', reader: {} },
      check: { status: 'verified' }, signingBlock: null, journal: { isReadable: () => true, entries: () => [] }, journalVersion: 0,
      ensureFreshCheck: async () => null, now: () => new Date(),
    };
    const { default: RequestNewPage } = await import('@/app/request/new/page');
    render(testnet(<RequestNewPage />));
    save('35-request-form', 'testnet');
    cleanup();
    S.config = configBase; S.mw = { ...(S.mw as object), status: 'connected', accountId: 'alice.near' }; S.vault = { identity: null, unlocked: false };
    S.op = { signer: { kind: 'ok', accountId: 'alice.near', signer: { kind: 'near-connect' } }, initial: null, next: null, sticky: false };
    const { CreateRequest } = await import('@/components/mainnet/CreateRequest');
    render(mainnet(<CreateRequest />));
    save('35-request-form', 'mainnet');
  });

  it('gift steps 2–4 (Personal Gift, 0.5 NEAR to bob, message, review)', async () => {
    S.taply = taplyProvisioned(); S.mode = 'taply';
    const { default: GiftNewPage } = await import('@/app/gift/new/page');
    render(testnet(<GiftNewPage />));
    fireEvent.click(screen.getByRole('button', { name: /Personal Gift/ }));
    fireEvent.change(document.querySelector('input.taply-input.chain-id')!, { target: { value: 'bob.testnet' } });
    fireEvent.change(document.querySelector('input.gift-amount-input')!, { target: { value: '0.5' } });
    save('36-gift-2-amount', 'testnet');
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'Happy birthday, Bob!' } });
    save('37-gift-3-envelope', 'testnet');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue/ })); });
    await waitFor(() => expect(document.getElementById('gift-review-title')).toBeTruthy());
    save('38-gift-4-review', 'testnet');
    cleanup();
    S.config = configBase; S.vault = { identity: mainnetIdentity, unlocked: true };
    S.op = { signer: internalSigner, initial: null, next: review('bob.near', '500000000000000000000000'), sticky: false };
    const { MainnetProduct } = await import('@/components/mainnet/MainnetProduct');
    render(mainnet(<MainnetProduct path="gift/new" />));
    fireEvent.click(screen.getByRole('button', { name: /Personal Gift/ }));
    fireEvent.change(document.getElementById('pg-to')!, { target: { value: 'bob.near' } });
    fireEvent.change(document.getElementById('pg-amount')!, { target: { value: '0.5' } });
    save('36-gift-2-amount', 'mainnet');
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    fireEvent.change(document.getElementById('pg-msg')!, { target: { value: 'Happy birthday, Bob!' } });
    save('37-gift-3-envelope', 'mainnet');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Continue/ })); });
    await waitFor(() => expect(screen.getByTestId('pg-review-card')).toBeTruthy());
    save('38-gift-4-review', 'mainnet');
  });
});
