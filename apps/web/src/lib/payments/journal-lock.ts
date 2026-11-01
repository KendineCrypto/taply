/**
 * Cross-tab serialisation for the submission journal.
 *
 * The journal is ONE localStorage blob (`taply.journal.v1`). Two tabs doing
 * read-modify-write at the same time can each write back a copy that lacks the
 * other's entry, silently deleting a duplicate brake. Every write therefore runs
 * under a single exclusive Web Lock for the whole journal namespace (never one
 * lock per request, which would still let two writers drop each other's
 * entries), and re-reads the blob after acquiring it.
 *
 * Without Web Locks (very old browsers, insecure origins) a new signing attempt
 * is refused: the brake would not be reliable. Bookkeeping writes after a
 * signature are still recorded, because losing an outcome is worse.
 */

export const JOURNAL_LOCK_NAME = 'taply.journal.v1';

export interface JournalLock {
  /** Runs `task` while holding the journal lock. */
  run<T>(task: () => T | Promise<T>): Promise<T>;
}

interface LockManagerLike {
  request(name: string, options: { mode: 'exclusive' }, callback: () => Promise<unknown>): Promise<unknown>;
}

/** Browser Web Locks, or null when unavailable (callers must then fail closed for new attempts). */
export function browserJournalLock(): JournalLock | null {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManagerLike }).locks;
  if (locks === undefined || typeof locks.request !== 'function') return null;
  return {
    run<T>(task: () => T | Promise<T>): Promise<T> {
      // The lock is held until the returned promise settles, then released.
      return locks.request(JOURNAL_LOCK_NAME, { mode: 'exclusive' }, async () => task()) as Promise<T>;
    },
  };
}

/**
 * A mutex for one JavaScript context. It does NOT coordinate tabs. Used by
 * tests, and as the shared stand-in when several in-process journals must
 * contend for the same storage.
 */
export function inProcessJournalLock(): JournalLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => T | Promise<T>): Promise<T> {
      const result = tail.then(() => task());
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
