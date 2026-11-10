import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WalletBalanceSnapshot, WalletChain } from '@taply/near-client';
import { createTaplyWalletController, TAPLY_WALLET_SIGNING_ENABLED } from '../taply-wallet';
import type { FaucetResult } from '../testnet-account';

const password = 'synthetic-test-only-passphrase';
const config = { network: 'near-testnet' as const, rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'unit', contract: null };
const controllers: Array<ReturnType<typeof createTaplyWalletController>> = [];
afterEach(() => { for (const c of controllers) c.dispose(); controllers.length = 0; vi.unstubAllGlobals(); });

function make(provisioned: boolean) {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { userAgent: 'unit-test', locks: {
    request: async (_name: string, _options: unknown, task: () => Promise<unknown>) => task(),
  } });
  const values = new Map<string, string>();
  const snapshot = vi.fn(async (accountId: string, publicKey: string): Promise<WalletBalanceSnapshot | null> => provisioned ? {
    network: 'near-testnet', accountId, publicKey, nonce: '1', blockHash: '1'.repeat(32), blockHeight: '1', blockTimestampNs: '1',
    amountYocto: '1000000000000000000000000', storageUsageBytes: '182', storageByteCostYocto: '10000000000000000000', gasPriceYocto: '100000000',
  } : null);
  const chain: WalletChain = { snapshot, checkNetwork: vi.fn(async () => {}), receiverExists: vi.fn(async () => {}),
    accountExists: vi.fn(async () => provisioned), provisioning: vi.fn(async () => (provisioned ? 'ON_CHAIN' as const : 'ACCOUNT_NOT_FOUND' as const)) };
  const controller = createTaplyWalletController({ config, storage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } },
    crypto: webcrypto as unknown as Crypto, chain });
  controllers.push(controller);
  return { controller, chain, snapshot };
}

describe('Taply local wallet controller (not the default external connector)', () => {
  it('does not generate a key, connect or prompt on construction', async () => {
    const { controller, snapshot } = make(false);
    expect(await controller.read()).toEqual({ status: 'NOT_CREATED' });
    expect(await controller.adapter.restore()).toBeNull();
    expect(snapshot).not.toHaveBeenCalled();
    // NEAR Testnet signing is on by owner decision; it still needs unlock, review and confirmation.
    expect(controller.signingEnabled).toBe(true);
    expect(TAPLY_WALLET_SIGNING_ENABLED).toBe(true);
  });
  it('generated identity and its exact QR stay local only without an on-chain account', async () => {
    const { controller } = make(false);
    const identity = await controller.create(password);
    expect(controller.receive().qrPayload).toBe(identity.accountId);
    expect(controller.receive().qr.size).toBeGreaterThan(0);
    expect((await controller.read()).status).toBe('LOCAL_ONLY');
    await controller.unlock(password);
    await expect(controller.adapter.connect()).rejects.toMatchObject({ kind: 'no_account' });
    await expect(controller.prepareSend('receiver.testnet', '0.1')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_PROVISIONED' });
  });
  it('connects only after unlock and provisioned-key reads; all transaction controls remain off', async () => {
    const { controller } = make(true);
    const identity = await controller.create(password);
    expect(await controller.adapter.restore()).toBeNull();
    await controller.unlock(password);
    expect((await controller.adapter.connect()).walletId).toBe('taply-local-testnet');
    const read = await controller.read();
    expect(read.status).toBe('PROVISIONED');
    if (read.status === 'PROVISIONED') expect(read.balance.accountId).toBe(identity.accountId);
    expect((await controller.prepareSend('receiver.testnet', '0.1')).depositYocto).toBe('100000000000000000000000');
    await expect(controller.adapter.signAndSendTransaction(identity.accountId, {
      receiverId: 'taply-pay-pilot-1.testnet', methodName: 'pay_instant_native', args: {}, gas: '50000000000000', depositYocto: '1',
    })).rejects.toMatchObject({ kind: 'unavailable' });
    // Leaving or hiding the page no longer locks (stay unlocked); Lock does.
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(controller.unlocked).toBe(true);
    controller.lock();
    expect(controller.unlocked).toBe(false);
    expect(controller.connected).toBe(false);
    expect(await controller.adapter.restore()).toBeNull();
  });
  it('refuses insecure browser contexts', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(() => createTaplyWalletController({ config, storage: localStorage })).toThrow('wallet:unavailable');
  });
  it('refuses vault creation without cross-tab Web Locks', async () => {
    const { controller } = make(false);
    vi.stubGlobal('navigator', { userAgent: 'unit-test' });
    await expect(controller.create(password)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await controller.read()).toEqual({ status: 'NOT_CREATED' });
  });
});

describe('username.testnet activation (faucet + FINAL proof)', () => {
  function named(faucetResult: FaucetResult, opts: { taken?: string[]; createOnFaucet?: boolean; appearAfter?: number } = {}) {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { userAgent: 'unit-test', locks: {
      request: async (_name: string, _options: unknown, task: () => Promise<unknown>) => task(),
    } });
    const values = new Map<string, string>();
    const created = new Set<string>();
    const taken = opts.taken ?? [];
    let reads = 0;
    const provisioning = vi.fn(async (id: string) => {
      if (created.has(id) && ++reads > (opts.appearAfter ?? 0)) return 'ON_CHAIN' as const;
      return taken.includes(id) ? 'KEY_NOT_ON_ACCOUNT' as const : 'ACCOUNT_NOT_FOUND' as const;
    });
    const chain: WalletChain = { checkNetwork: vi.fn(async () => {}), receiverExists: vi.fn(async () => {}),
      snapshot: vi.fn(async () => null), accountExists: vi.fn(async (id: string) => taken.includes(id) || created.has(id)), provisioning };
    const requestAccount = vi.fn(async (id: string, publicKey: string) => {
      expect(publicKey).toMatch(/^ed25519:/);
      if (opts.createOnFaucet ?? faucetResult.ok) created.add(id);
      return faucetResult;
    });
    const sleep = vi.fn(async () => {});
    const controller = createTaplyWalletController({ config, storage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } },
      crypto: webcrypto as unknown as Crypto, chain, requestAccount, sleep });
    controllers.push(controller);
    return { controller, requestAccount, provisioning, sleep };
  }

  it('availability is a FINAL read; a named vault is created locally and stays LOCAL_ONLY until proven', async () => {
    const { controller, requestAccount } = named({ ok: true }, { taken: ['taken.testnet'] });
    expect(await controller.isAccountAvailable('taken.testnet')).toBe(false);
    expect(await controller.isAccountAvailable('alice.testnet')).toBe(true);
    const identity = await controller.createNamed(password, 'alice.testnet');
    expect(identity).toMatchObject({ accountId: 'alice.testnet', provisioning: 'LOCAL_ONLY' });
    expect((await controller.read()).status).toBe('LOCAL_ONLY');
    expect(requestAccount).not.toHaveBeenCalled();
    expect(controller.unlocked).toBe(false);
  });
  it('faucet success is confirmed only by polling FINAL provisioning; one request for parallel taps', async () => {
    const { controller, requestAccount, provisioning, sleep } = named({ ok: true }, { appearAfter: 2 });
    await controller.createNamed(password, 'alice.testnet');
    const [a, b] = await Promise.all([controller.activate(), controller.activate()]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ status: 'ON_CHAIN', identity: { accountId: 'alice.testnet', provisioning: 'ON_CHAIN' } });
    expect(requestAccount).toHaveBeenCalledTimes(1);
    expect(requestAccount.mock.calls[0]?.[1]).toMatch(/^ed25519:/);
    expect(provisioning.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(sleep).toHaveBeenCalled();
    // Already on chain: no second faucet request.
    expect((await controller.activate()).status).toBe('ON_CHAIN');
    expect(requestAccount).toHaveBeenCalledTimes(1);
  });
  it('faucet ok but never visible is PENDING, not success', async () => {
    const { controller } = named({ ok: true }, { createOnFaucet: false });
    await controller.createNamed(password, 'slow.testnet');
    expect(await controller.activate()).toEqual({ status: 'PENDING' });
  });
  it('faucet failures keep the vault and report the reason; a timeout that did create the account still wins', async () => {
    const limited = named({ ok: false, reason: 'rate_limited' });
    await limited.controller.createNamed(password, 'bob.testnet');
    expect(await limited.controller.activate()).toEqual({ status: 'FAUCET_FAILED', reason: 'rate_limited' });
    expect((await limited.controller.read()).status).toBe('LOCAL_ONLY');
    const timedOut = named({ ok: false, reason: 'unavailable' }, { createOnFaucet: true });
    await timedOut.controller.createNamed(password, 'eve.testnet');
    expect((await timedOut.controller.activate()).status).toBe('ON_CHAIN');
  });
  it('a name held by another key is NAME_TAKEN without a faucet call; rebind needs a free name and the passphrase', async () => {
    const { controller, requestAccount } = named({ ok: true }, { taken: ['taken.testnet', 'also-taken.testnet'] });
    const first = await controller.createNamed(password, 'taken.testnet');
    expect(await controller.activate()).toEqual({ status: 'NAME_TAKEN' });
    expect(requestAccount).not.toHaveBeenCalled();
    await expect(controller.rebindName(password, 'also-taken.testnet')).rejects.toMatchObject({ name: 'TaplyNameTakenError' });
    await expect(controller.rebindName('wrong but long passphrase', 'free.testnet')).rejects.toMatchObject({ code: 'BAD_PASSWORD_OR_DATA' });
    const next = await controller.rebindName(password, 'free.testnet');
    expect(next).toMatchObject({ accountId: 'free.testnet', publicKeyHex: first.publicKeyHex });
    expect((await controller.activate()).status).toBe('ON_CHAIN');
    // Once proven on chain, the name can no longer be swapped.
    await expect(controller.rebindName(password, 'other.testnet')).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
  });
  it('an implicit (pre-username) vault is never sent to the faucet', async () => {
    const { controller, requestAccount } = named({ ok: true });
    await controller.create(password);
    await expect(controller.activate()).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
    expect(requestAccount).not.toHaveBeenCalled();
  });
});

describe('stay unlocked (owner request 2026-11-10)', () => {
  it('one password entry: a new page resumes unlocked without it; Lock ends it for every page', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { userAgent: 'unit-test', locks: { request: async (_n: string, _o: unknown, task: () => Promise<unknown>) => task() } });
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
    type Saved = { key: CryptoKey; record: string; expiresAt: number };
    const box: { saved: Saved | null } = { saved: null };
    const session = { save: async (v: Saved) => { box.saved = v; }, load: async () => box.saved, clear: async () => { box.saved = null; } };
    const chain: WalletChain = { snapshot: vi.fn(async () => null), checkNetwork: vi.fn(async () => {}), receiverExists: vi.fn(async () => {}),
      accountExists: vi.fn(async () => false), provisioning: vi.fn(async () => 'ACCOUNT_NOT_FOUND' as const) };
    const make = () => {
      const c = createTaplyWalletController({ config, storage, crypto: webcrypto as unknown as Crypto, chain, session });
      controllers.push(c);
      return c;
    };
    const page1 = make();
    await page1.createNamed(password, 'stays-open.testnet');
    await page1.unlock(password);
    expect(box.saved?.key.extractable).toBe(false);
    expect((box.saved?.expiresAt ?? 0) - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    page1.dispose(); // page teardown is not a lock
    const page2 = make();
    expect(page2.unlocked).toBe(false);
    expect(await page2.resume()).toBe(true);
    expect(page2.unlocked).toBe(true);
    page2.lock();
    await new Promise((r) => setTimeout(r, 0));
    const page3 = make();
    expect(await page3.resume()).toBe(false);
    expect(page3.unlocked).toBe(false);
  });
});
