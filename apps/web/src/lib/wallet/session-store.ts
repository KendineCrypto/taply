import type { VaultSessionStore } from '@taply/near-client';

/**
 * IndexedDB store for Taply Wallet's unlocked session ("stay unlocked", owner
 * request 2026-11-10). It holds the NONEXTRACTABLE signing CryptoKey as a
 * structured clone: the browser can sign with it, but no script can read the
 * private key out of it. The vault binds it to the exact vault record and an
 * expiry, and verifies it with a fresh signature before using it.
 * Returns null where IndexedDB is unavailable (the unlock then lasts for the page).
 */
const DB = 'taply.wallet-session.v1';
const STORE = 'session';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb'));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error('indexeddb'));
      tx.onabort = () => reject(tx.error ?? new Error('indexeddb'));
    });
  } finally {
    db.close();
  }
}

export function createIndexedDbSessionStore(): VaultSessionStore | null {
  if (typeof indexedDB === 'undefined') return null;
  return {
    async save(session) {
      await run('readwrite', (store) => store.put({ key: session.key, record: session.record, expiresAt: session.expiresAt }, KEY));
    },
    async load() {
      const value: unknown = await run('readonly', (store) => store.get(KEY));
      if (typeof value !== 'object' || value === null) return null;
      const v = value as { key?: unknown; record?: unknown; expiresAt?: unknown };
      if (!(v.key instanceof CryptoKey) || typeof v.record !== 'string' || typeof v.expiresAt !== 'number') return null;
      return { key: v.key, record: v.record, expiresAt: v.expiresAt };
    },
    async clear() {
      await run('readwrite', (store) => store.delete(KEY));
    },
  };
}
