import type { MainnetVaultSessionStore } from '@taply/near-client';
import { createIndexedDbSessionStore } from '../wallet/session-store';

const TAB_KEY = 'taply.mainnet-unlock-tab.v1';
const DATABASE = 'taply.mainnet-wallet-session.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Only a random row identifier enters sessionStorage. The vault retains its
 * original expiry and independently validates the nonextractable signing key.
 * Mainnet sessions never share Testnet's database or a global current row. */
export function createMainnetVaultSessionStore(): MainnetVaultSessionStore | null {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return null;
  try {
    const tab = window.sessionStorage;
    let id = tab.getItem(TAB_KEY);
    if (id === null || !UUID.test(id)) {
      id = crypto.randomUUID();
      tab.setItem(TAB_KEY, id);
    }
    const row = id;
    const store = createIndexedDbSessionStore({ databaseName: DATABASE, sessionKey: row });
    if (store === null) return null;
    return {
      async save(session) { tab.setItem(TAB_KEY, row); await store.save(session); },
      async load() { return tab.getItem(TAB_KEY) === row ? store.load() : null; },
      async clear() {
        // Revoke synchronously, before IndexedDB's asynchronous delete. A reload
        // racing an explicit lock must not recover the old persisted key.
        try { if (tab.getItem(TAB_KEY) === row) tab.removeItem(TAB_KEY); }
        finally { await store.clear(); }
      },
    };
  } catch { return null; } // Storage blocked: preserve page-only unlocking.
}
