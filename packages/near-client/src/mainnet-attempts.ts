import { z } from 'zod';
import { MainnetAccountSchema, HashHexSchema, parseStrictJson } from '@taply/shared';
import { HashSchema } from './validation.js';

const Attempt = z.strictObject({ version: z.literal(1), network: z.literal('near-mainnet'),
  accountId: MainnetAccountSchema, operationHash: HashHexSchema, attemptId: z.uuid(),
  state: z.enum(['RESERVED', 'HANDOFF', 'UNCERTAIN']), transactionHash: HashSchema.nullable() });
export type MainnetAttempt = z.infer<typeof Attempt>;
/** CAS must be atomic across tabs and durable before resolving. No TTL or eviction.
 * A read-then-write localStorage implementation does NOT satisfy this interface. */
export interface MainnetAttemptStore {
  read(accountId: string): Promise<string | null>;
  compareAndSwap(accountId: string, expected: string | null, next: string): Promise<boolean>;
}
export function createMainnetAttemptJournal(store: MainnetAttemptStore) {
  const parse = (raw: string | null, accountId: string) => {
    if (raw === null) return null;
    if (raw.length > 2048) throw new Error('INVALID_ATTEMPT');
    const value = Attempt.parse(parseStrictJson(raw));
    if (value.accountId !== accountId) throw new Error('INVALID_ATTEMPT');
    return value;
  };
  return Object.freeze({
    async read(accountId: string) { MainnetAccountSchema.parse(accountId); return parse(await store.read(accountId), accountId); },
    async reserve(accountId: string, operationHash: string): Promise<MainnetAttempt> {
      const attempt = Attempt.parse({ version: 1, network: 'near-mainnet', accountId, operationHash,
        attemptId: globalThis.crypto.randomUUID(), state: 'RESERVED', transactionHash: null });
      if (!await store.compareAndSwap(accountId, null, JSON.stringify(attempt))) throw new Error('OUTCOME_UNRESOLVED');
      // Losing the commit acknowledgement must never produce permission to hand off.
      return Object.freeze(attempt);
    },
    async transition(expected: MainnetAttempt, state: 'HANDOFF' | 'UNCERTAIN', transactionHash: string | null = null) {
      const old = Attempt.parse(expected);
      if ((state === 'HANDOFF' && old.state !== 'RESERVED') || (state === 'UNCERTAIN' && old.state === 'UNCERTAIN'))
        throw new Error('INVALID_ATTEMPT_TRANSITION');
      if (old.transactionHash !== null && transactionHash !== old.transactionHash) throw new Error('TRANSACTION_HASH_MISMATCH');
      const next = Attempt.parse({ ...old, state, transactionHash });
      if (!await store.compareAndSwap(old.accountId, JSON.stringify(old), JSON.stringify(next))) throw new Error('STALE_ATTEMPT');
      return Object.freeze(next);
    },
  });
}
/** IndexedDB readwrite transactions serialize all tabs using this origin/database.
 * Successful requests alone are NOT commit acknowledgements: wait for oncomplete.
 * No reset/delete API. Browser storage deletion/rollback remains a release risk. */
export async function openMainnetAttemptStore(factory: IDBFactory = globalThis.indexedDB): Promise<MainnetAttemptStore & { close(): void }> {
  if (!factory) throw new Error('DURABLE_STORAGE_UNAVAILABLE');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open('taply.mainnet.attempts.v1', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('attempts'); };
    open.onerror = () => reject(new Error('DURABLE_STORAGE_UNAVAILABLE'));
    open.onblocked = () => reject(new Error('DURABLE_STORAGE_BLOCKED'));
    open.onsuccess = () => resolve(open.result);
  });
  db.onversionchange = () => db.close();
  function operation(accountId: string, expected?: string | null, next?: string): Promise<string | null | boolean> {
    MainnetAccountSchema.parse(accountId);
    return new Promise((resolve, reject) => {
      const write = next !== undefined;
      const tx = db.transaction('attempts', write ? 'readwrite' : 'readonly', { durability: 'strict' });
      const store = tx.objectStore('attempts');
      const get = store.get(accountId);
      let result: string | null | boolean = null;
      tx.onabort = tx.onerror = () => reject(new Error('DURABLE_STORAGE_UNAVAILABLE'));
      tx.oncomplete = () => resolve(result);
      get.onsuccess = () => {
        if (get.result !== undefined && typeof get.result !== 'string') { tx.abort(); return; }
        const raw: string | null = get.result ?? null;
        if (!write) { result = raw; return; }
        result = raw === expected;
        if (result) store.put(next, accountId);
      };
    });
  }
  return Object.freeze({ read: async (id: string) => await operation(id) as string | null,
    compareAndSwap: async (id: string, expected: string | null, next: string) => await operation(id, expected, next) as boolean,
    close: () => db.close() });
}
