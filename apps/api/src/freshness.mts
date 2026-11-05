import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';
import { DurableStore } from './storage.mts';

export type FreshnessAnchor = Readonly<{ epoch: string; revision: string; digest: string }>;
/** External trusted, authenticated, linearizable, non-restorable authority.
 * Its epoch/heads must NEVER share the database/backup/admin rollback domain.
 * CAS must validate immutable epoch, exact old head, revision+1, and never reuse
 * a scope/epoch or roll back acknowledged decisions. Timeout outcome is unknown.
 * No production provider is supplied. A local file/counter is NOT such authority. */
export interface FreshnessAuthority {
  read(scope: string): Promise<FreshnessAnchor>;
  compareAndSwap(scope: string, expected: FreshnessAnchor, next: FreshnessAnchor): Promise<boolean>;
}
export type FencedState<T> = { format: 'taply.fenced-state.v1'; epoch: string; revision: string; state: T };
function valid(value: FreshnessAnchor): void {
  if (!value || !/^[a-f0-9]{64}$/.test(value.epoch) || !/^(0|[1-9][0-9]{0,19})$/.test(value.revision)
    || BigInt(value.revision) > 18446744073709551615n || !/^[a-f0-9]{64}$/.test(value.digest)) throw Error('VERIFICATION_UNAVAILABLE');
}
const same = (a: FreshnessAnchor, b: FreshnessAnchor) => a.epoch === b.epoch && a.revision === b.revision && a.digest === b.digest;
export function freshnessAnchor<T>(scope: string, value: FencedState<T>): FreshnessAnchor {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(scope) || value?.format !== 'taply.fenced-state.v1') throw Error('VERIFICATION_UNAVAILABLE');
  const anchor = { epoch: value.epoch, revision: value.revision,
    digest: createHash('sha256').update('taply.freshness.v1\n').update(scope).update('\n').update(serialize(value)).digest('hex') };
  valid(anchor); return anchor;
}

/** New opt-in namespace/format ONLY, no migration of current auth/room databases.
 * Each local write also CAS-checks the expected payload under BEGIN IMMEDIATE.
 * The external authority must be separately provisioned with the initial anchor;
 * opening a store never initializes/resets that authority. */
export class SqliteFencedRepository<T> {
  #store: DurableStore<FencedState<T>>; #scope: string;
  constructor(path: string, key: Uint8Array, namespace: string, scope: string, initial: () => FencedState<T>, initialize = false) {
    this.#scope = scope;
    this.#store = new DurableStore(path, key, namespace, initial, initialize, state => { freshnessAnchor(scope, state); });
  }
  read(): FencedState<T> { return this.#store.transaction(state => state); }
  compareAndSwap(expected: FreshnessAnchor, next: FencedState<T>): void {
    this.#store.transaction(current => {
      if (!same(freshnessAnchor(this.#scope, current), expected)) throw Error('VERIFICATION_UNAVAILABLE');
      Object.assign(current, structuredClone(next));
    });
  }
  close(): void { this.#store.close(); }
}

/** Commit protocol: read local+external head -> compute synchronous decision ->
 * external CAS advances/fences -> local CAS/commit -> confirm external head.
 * A crash/timeout between commits deliberately requires controlled recovery.
 * No result escapes before both commits. Even reads advance the head so an old
 * auth/session snapshot cannot authorize a lookup after a later decision.
 * Existing synchronous DurableAuth/SessionPersistence are NOT wired to this
 * asynchronous protocol. Deployment needs an external provider and integration
 * review, not a flag. No signer, funds authority or automatic recovery exists. */
export class FencedTransactions<T> {
  #repo: SqliteFencedRepository<T>; #authority: FreshnessAuthority; #scope: string; #healthy = true; #busy = false;
  constructor(repo: SqliteFencedRepository<T>, authority: FreshnessAuthority, scope: string) {
    this.#repo = repo; this.#authority = authority; this.#scope = scope;
  }
  async transaction<R>(action: (state: T) => R): Promise<R> {
    if (!this.#healthy || this.#busy) throw Error('VERIFICATION_UNAVAILABLE');
    this.#busy = true; let advanced = false, checked = false;
    try {
      const current = this.#repo.read(), expected = freshnessAnchor(this.#scope, current);
      const head = await this.#authority.read(this.#scope); valid(head);
      if (!same(head, expected)) throw Error('VERIFICATION_UNAVAILABLE');
      checked = true;
      const next = structuredClone(current), result = action(next.state);
      if (result instanceof Promise) throw Error('INVALID_ARGUMENT');
      const output = structuredClone(result);
      next.revision = String(BigInt(expected.revision) + 1n);
      const anchor = freshnessAnchor(this.#scope, next);
      // Treat invocation as uncertain until an explicit false or confirmed commit.
      advanced = true;
      if (!await this.#authority.compareAndSwap(this.#scope, expected, anchor)) throw Error('VERIFICATION_UNAVAILABLE');
      this.#repo.compareAndSwap(expected, next);
      const committed = await this.#authority.read(this.#scope); valid(committed);
      if (!same(committed, anchor)) throw Error('VERIFICATION_UNAVAILABLE');
      return output;
    } catch (error) {
      if (!checked || advanced) this.#healthy = false;
      throw error;
    } finally { this.#busy = false; }
  }
}
