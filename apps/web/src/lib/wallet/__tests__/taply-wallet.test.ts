import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WalletBalanceSnapshot, WalletChain } from '@taply/near-client';
import { createTaplyWalletController, TAPLY_WALLET_SIGNING_ENABLED } from '../taply-wallet';

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
  const chain: WalletChain = { snapshot, checkNetwork: vi.fn(async () => {}), receiverExists: vi.fn(async () => {}) };
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
    expect(controller.signingEnabled).toBe(false);
    expect(TAPLY_WALLET_SIGNING_ENABLED).toBe(false);
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
    window.dispatchEvent(new Event('pagehide'));
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
