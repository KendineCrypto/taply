import type { MainnetGlobalAttemptStore } from '@taply/near-client';

/**
 * Device-local payment ledger: durable compare-and-swap on ONE browser (IndexedDB).
 * Codex's coordinator runs unchanged on top of it (reserve-before-handoff, UNCERTAIN
 * blocks, FINAL reconciliation, permanent tombstones). It does NOT prevent a duplicate
 * started from another device: that needs the server authority + witness
 * (docs/MAINNET_RELEASE.md, "Device ledger"). No delete, TTL or reset exists here.
 */
const DB = 'taply-mainnet-ledger';
const STORE = 'ledger';

type IdbFactory = Pick<IDBFactory, 'open'>;

function open(idb: IdbFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('JOURNAL_UNAVAILABLE'));
    req.onblocked = () => reject(new Error('JOURNAL_UNAVAILABLE'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('JOURNAL_UNAVAILABLE'));
    tx.onabort = () => reject(tx.error ?? new Error('JOURNAL_UNAVAILABLE'));
  });
}

export function deviceLedgerStore(idb: IdbFactory): MainnetGlobalAttemptStore {
  let db: Promise<IDBDatabase> | null = null;
  const conn = () => (db ??= open(idb).catch((e: unknown) => { db = null; throw e; }));
  return {
    scope: 'device-local',
    async read(accountId) {
      const tx = (await conn()).transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(accountId);
      await done(tx);
      const v: unknown = req.result;
      if (v === undefined) return null;
      if (typeof v !== 'string') throw new Error('INVALID_LEDGER');
      return v;
    },
    async compareAndSwap(accountId, expected, next) {
      // One readwrite transaction: IndexedDB serializes overlapping readwrite scopes, so
      // concurrent tabs cannot both see `expected` and both write.
      const tx = (await conn()).transaction(STORE, 'readwrite', { durability: 'strict' });
      // A browser that ignores the durability option cannot acknowledge a
      // pre-signing fence safely. Never downgrade to default/relaxed writes.
      if (tx.durability !== 'strict') {
        tx.abort();
        throw new Error('JOURNAL_UNAVAILABLE');
      }
      const os = tx.objectStore(STORE);
      let swapped = false;
      const get = os.get(accountId);
      get.onsuccess = () => {
        const current: unknown = get.result === undefined ? null : get.result;
        if (current === expected) { os.put(next, accountId); swapped = true; }
      };
      await done(tx);
      return swapped;
    },
  };
}
