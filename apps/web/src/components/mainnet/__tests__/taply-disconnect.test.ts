// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Taply Wallet "disconnect" on a REAL EncryptedMainnetVault (node WebCrypto),
 * with an in-memory localStorage. A test password only; no chain access.
 */
const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage, sessionStorage: storage, addEventListener: () => {} };
});

describe('forgetTaplyWallet', () => {
  it('needs the right password, then removes only the wallet record and leaves a clean vault', async () => {
    const { vault, forgetTaplyWallet } = await import('../Wallet');
    const { MAINNET_WALLET_STORAGE_KEY } = await import('@taply/near-client');
    mem.set('taply.mainnet.device.v1', '11111111-1111-4111-8111-111111111111');
    mem.set('unrelated', 'kept');
    await vault().create('correct horse battery');
    expect(mem.has(MAINNET_WALLET_STORAGE_KEY)).toBe(true);

    await expect(forgetTaplyWallet('wrong password!!', storage)).rejects.toThrow();
    expect(mem.has(MAINNET_WALLET_STORAGE_KEY)).toBe(true);
    expect(vault().getIdentity()).not.toBeNull();

    await forgetTaplyWallet('correct horse battery', storage);
    expect(mem.has(MAINNET_WALLET_STORAGE_KEY)).toBe(false);
    // Device id and anything else on this browser are untouched.
    expect(mem.get('taply.mainnet.device.v1')).toBe('11111111-1111-4111-8111-111111111111');
    expect(mem.get('unrelated')).toBe('kept');
    // A fresh vault sees no wallet and is locked.
    expect(vault().getIdentity()).toBeNull();
    expect(vault().unlocked).toBe(false);
  }, 60_000);

  it('refuses when there is no wallet on this device', async () => {
    const { forgetTaplyWallet } = await import('../Wallet');
    await expect(forgetTaplyWallet('anything at all', storage)).rejects.toThrow();
  });
});
