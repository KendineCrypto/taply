import { DatabaseSync } from 'node:sqlite';
import { serialize, deserialize } from 'node:v8';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { SessionDatabase, SessionPersistence } from './sessions.mts';

/** Single-host SQLite, durable atomic encrypted state. Caller supplies a dedicated
 * service encryption key (not a wallet key) from outside the database directory.
 * Existing missing/corrupt databases never silently initialize on restart. */
export class DurableStore<T> {
  #db: DatabaseSync; #key: Buffer; #namespace: string; #healthy = true;
  constructor(path: string, key: Uint8Array, namespace: string, initial: () => T, initialize = false) {
    if (key.byteLength !== 32 || !/^[a-z-]{1,32}$/.test(namespace) || path === ':memory:') throw Error('INVALID_ARGUMENT');
    if (!existsSync(path) && !initialize) throw Error('VERIFICATION_UNAVAILABLE');
    this.#key = Buffer.from(key); this.#namespace = namespace;
    this.#db = new DatabaseSync(path, { timeout: 1000, allowExtension: false });
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; CREATE TABLE IF NOT EXISTS state (name TEXT PRIMARY KEY, payload BLOB NOT NULL) STRICT');
    if (!this.#db.prepare('SELECT name FROM state WHERE name=?').get(namespace)) {
      if (!initialize) { this.close(); throw Error('VERIFICATION_UNAVAILABLE'); }
      const bytes = this.#encrypt(initial());
      this.#db.prepare('INSERT OR IGNORE INTO state VALUES (?,?)').run(namespace, bytes);
    }
    try { this.transaction(value => value); } // Authenticate existing state before use.
    catch (error) { this.close(); throw error; }
  }
  #encrypt(value: T): Buffer {
    const bytes = serialize(value); if (bytes.length > 8 * 1024 * 1024) throw Error('RATE_LIMITED');
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
    cipher.setAAD(Buffer.from(`taply.storage.v1:${this.#namespace}`));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  }
  transaction<R>(action: (state: T) => R): R {
    if (!this.#healthy) throw Error('VERIFICATION_UNAVAILABLE');
    let started = false, committing = false;
    try {
      this.#db.exec('BEGIN IMMEDIATE'); started = true;
      const row = this.#db.prepare('SELECT payload FROM state WHERE name=?').get(this.#namespace);
      if (!(row?.payload instanceof Uint8Array) || row.payload.length > 8 * 1024 * 1024 + 28) throw Error('VERIFICATION_UNAVAILABLE');
      const bytes = Buffer.from(row.payload); const decipher = createDecipheriv('aes-256-gcm', this.#key, bytes.subarray(0,12));
      decipher.setAAD(Buffer.from(`taply.storage.v1:${this.#namespace}`)); decipher.setAuthTag(bytes.subarray(12,28));
      const state = deserialize(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])) as T;
      const result = action(state);
      if (result instanceof Promise) throw Error('INVALID_ARGUMENT');
      const output = structuredClone(result);
      this.#db.prepare('UPDATE state SET payload=? WHERE name=?').run(this.#encrypt(state), this.#namespace);
      committing = true; this.#db.exec('COMMIT'); return output;
    } catch (error) {
      if (committing) this.#healthy = false;
      if (started) { try { this.#db.exec('ROLLBACK'); } catch { this.#healthy = false; } }
      throw error;
    }
  }
  close(): void { this.#healthy = false; this.#key.fill(0); this.#db.close(); }
}
export class SqliteSessionPersistence implements SessionPersistence {
  #store: DurableStore<SessionDatabase>;
  constructor(path: string, key: Uint8Array, initialize = false) {
    this.#store = new DurableStore(path, key, 'handshake', () => ({ entries:new Map(), creates:new Map() }), initialize);
  }
  transaction<T>(action: (db: SessionDatabase) => T): T { return this.#store.transaction(action); }
  close(): void { this.#store.close(); }
}
