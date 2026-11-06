import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOURNAL_STORAGE_KEY, JournalBlockedError, JournalUnavailableError, SubmissionJournal, isBlocking } from '../journal';
import type { JournalStorage } from '../journal';
import { JOURNAL_LOCK_NAME, browserJournalLock, inProcessJournalLock } from '../journal-lock';
import type { JournalLock } from '../journal-lock';
import { submitCall } from '../submit';
import type { SignOutcome } from '@/lib/wallet/adapter';

/**
 * Phase 5C: the external-wallet journal is one localStorage blob shared by all
 * tabs. Writes are serialised under ONE namespace lock and re-read inside it,
 * new attempts fail closed without a lock, and UNKNOWN outcomes keep blocking
 * across journal instances (tabs).
 */

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const TX = '4uxbZn8HLNDdvKpNGMNEC8W5uP5QQ3TuRAoUgTr1gt1a';

function memory(): JournalStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const entry = (requestId: string) => ({
  method: 'pay_instant_native' as const,
  network: 'near-testnet' as const,
  contractId: 'pay.testnet',
  requestId,
  termsHash: 'c'.repeat(64),
  signerAccountId: 'payer.testnet',
  terms: null,
  operationNonce: null,
});

const call = (requestId: string) => ({
  receiverId: 'pay.testnet',
  methodName: 'pay_instant_native' as const,
  args: { id: requestId },
  gas: '50000000000000',
  depositYocto: '1',
});

/** Two "tabs": separate journal instances over the same storage and lock. */
function tabs(lock: JournalLock = inProcessJournalLock()) {
  const storage = memory();
  return { storage, one: new SubmissionJournal(storage, undefined, lock), two: new SubmissionJournal(storage, undefined, lock) };
}

afterEach(() => vi.unstubAllGlobals());

describe('journal lock', () => {
  it('serializes distinct sale creations across tabs until chain reconciliation, with account isolation', async () => {
    const { one, two } = tabs();
    const create = (id: string) => ({ ...entry(id), method: 'create_request' as const });
    const results = await Promise.allSettled([one.begin(create(A)), two.begin(create(B))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(JournalBlockedError);
    await expect(two.begin({ ...create(B), signerAccountId: 'other.testnet' })).resolves.toMatchObject({ signerAccountId: 'other.testnet' });
    const first = one.entries().find(e => e.signerAccountId === 'payer.testnet');
    if (!first) throw new Error('missing first sale');
    await one.update(first, { phase: 'RESOLVED' });
    await expect(two.begin(create(B))).resolves.toMatchObject({ requestId: B });
  });

  it('late work for a replaced attempt cannot resolve or attach a hash to the new attempt', async () => {
    const storage = memory();
    const journal = new SubmissionJournal(storage, () => new Date('2026-11-01T10:00:00Z'), inProcessJournalLock());
    const first = await journal.begin(entry(A));
    await journal.update(first, { phase: 'RESOLVED' });
    const second = await journal.begin(entry(A));
    expect(second.startedAt).not.toBe(first.startedAt);
    await expect(journal.update(first, { phase: 'RESOLVED', transactionHash: TX })).rejects.toThrow('superseded');
    expect(journal.find(A, 'pay_instant_native', 'payer.testnet')).toEqual(second);
    await expect(journal.begin(entry(A))).rejects.toThrow(JournalBlockedError);
  });

  it('concurrent recovery cannot overwrite a known hash or downgrade a submitted attempt', async () => {
    const { one, two } = tabs();
    const target = await one.begin(entry(A));
    await one.update(target, { phase: 'SUBMITTED', transactionHash: TX });
    await two.update(target, { phase: 'SUBMITTED', transactionHash: '1'.repeat(32) });
    await two.update(target, { phase: 'USER_REJECTED' });
    expect(one.find(A, 'pay_instant_native', 'payer.testnet')).toMatchObject({ phase: 'SUBMITTED', transactionHash: TX });
  });
  it('concurrent attempts for the same request from two tabs open the wallet once', async () => {
    const { one, two } = tabs();
    let prompts = 0;
    // The wallet stays open (never answers) while the second tab tries.
    const wallet = () => {
      prompts += 1;
      return new Promise<SignOutcome>(() => undefined);
    };
    void submitCall({ journal: one, call: call(A), signerAccountId: 'payer.testnet', requestId: A, termsHash: 'c'.repeat(64), signAndSend: wallet });
    const second = await submitCall({ journal: two, call: call(A), signerAccountId: 'payer.testnet', requestId: A, termsHash: 'c'.repeat(64), signAndSend: wallet });
    expect(second.kind).toBe('blocked');
    expect(prompts).toBe(1);
  });

  it('writes from two tabs never drop each other’s entries', async () => {
    const { one, two } = tabs();
    await Promise.all([one.begin(entry(A)), two.begin(entry(B)), one.begin(entry('d'.repeat(64)))]);
    await Promise.all([
      two.update({ requestId: A, method: 'pay_instant_native', signerAccountId: 'payer.testnet' }, { phase: 'OUTCOME_UNKNOWN' }),
      one.update({ requestId: B, method: 'pay_instant_native', signerAccountId: 'payer.testnet' }, { phase: 'SUBMITTED', transactionHash: TX }),
    ]);
    const all = one.entries();
    expect(all.map((e) => e.requestId).sort()).toEqual([A, B, 'd'.repeat(64)].sort());
    expect(all.find((e) => e.requestId === A)?.phase).toBe('OUTCOME_UNKNOWN');
    expect(all.find((e) => e.requestId === B)).toMatchObject({ phase: 'SUBMITTED', transactionHash: TX });
  });

  it('re-reads storage inside the lock: an entry another tab wrote meanwhile blocks this attempt', async () => {
    const order: string[] = [];
    // A lock that lets the "other tab" write while this tab is waiting for it.
    const base = inProcessJournalLock();
    const lock: JournalLock = {
      run: (task) =>
        base.run(() => {
          order.push('locked');
          return task();
        }),
    };
    const { one, two } = tabs(lock);
    const otherTab = two.begin(entry(A)); // queued first
    const thisTab = one.begin(entry(A));
    await otherTab;
    await expect(thisTab).rejects.toThrow(JournalBlockedError);
    expect(order).toEqual(['locked', 'locked']);
  });

  it('an UNKNOWN outcome in one tab keeps blocking every tab', async () => {
    const { one, two } = tabs();
    const first = await submitCall({
      journal: one,
      call: call(A),
      signerAccountId: 'payer.testnet',
      requestId: A,
      termsHash: 'c'.repeat(64),
      signAndSend: async () => ({ kind: 'unknown' }),
    });
    expect(first.kind).toBe('unknown');
    const signed: unknown[] = [];
    const again = await submitCall({
      journal: two,
      call: call(A),
      signerAccountId: 'payer.testnet',
      requestId: A,
      termsHash: 'c'.repeat(64),
      signAndSend: async () => (signed.push(1), { kind: 'submitted', transactionHash: TX }),
    });
    expect(again.kind).toBe('blocked');
    expect(signed).toHaveLength(0);
    const stored = two.find(A, 'pay_instant_native', 'payer.testnet');
    expect(stored !== null && isBlocking(stored)).toBe(true);
  });

  it('without a lock: no new attempt and no wallet prompt, but outcomes are still recorded', async () => {
    const storage = memory();
    const unlocked = new SubmissionJournal(storage, undefined, null);
    await expect(unlocked.begin(entry(A))).rejects.toThrow(JournalUnavailableError);
    const signed: unknown[] = [];
    const result = await submitCall({
      journal: unlocked,
      call: call(A),
      signerAccountId: 'payer.testnet',
      requestId: A,
      termsHash: 'c'.repeat(64),
      signAndSend: async () => (signed.push(1), { kind: 'unknown' }),
    });
    expect(result).toEqual({ kind: 'no_journal' });
    expect(signed).toHaveLength(0);
    // An entry from a locked context (e.g. before the lock vanished) can still be updated.
    await new SubmissionJournal(storage, undefined, inProcessJournalLock()).begin(entry(B));
    await unlocked.update({ requestId: B, method: 'pay_instant_native', signerAccountId: 'payer.testnet' }, { phase: 'OUTCOME_UNKNOWN' });
    expect(unlocked.find(B, 'pay_instant_native', 'payer.testnet')?.phase).toBe('OUTCOME_UNKNOWN');
  });

  it('a hash that cannot be recorded is reported as unknown, never as a clean submission', async () => {
    const storage = memory();
    const journal = new SubmissionJournal(storage, undefined, inProcessJournalLock());
    const result = await submitCall({
      journal,
      call: call(A),
      signerAccountId: 'payer.testnet',
      requestId: A,
      termsHash: 'c'.repeat(64),
      signAndSend: async () => {
        // Storage breaks while the wallet is open.
        storage.setItem(JOURNAL_STORAGE_KEY, '{not json');
        return { kind: 'submitted', transactionHash: TX };
      },
    });
    expect(result).toEqual({ kind: 'unknown', transactionHash: TX });
  });

  it('uses one exclusive Web Lock for the whole journal namespace', async () => {
    const requests: Array<{ name: string; mode: string }> = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, options: { mode: string }, callback: () => Promise<unknown>) => {
          requests.push({ name, mode: options.mode });
          return callback();
        },
      },
    });
    const lock = browserJournalLock();
    expect(lock).not.toBeNull();
    const journal = new SubmissionJournal(memory(), undefined, lock);
    await journal.begin(entry(A));
    await journal.begin(entry(B));
    await journal.update({ requestId: A, method: 'pay_instant_native', signerAccountId: 'payer.testnet' }, { phase: 'USER_REJECTED' });
    expect(requests).toEqual([
      { name: JOURNAL_LOCK_NAME, mode: 'exclusive' },
      { name: JOURNAL_LOCK_NAME, mode: 'exclusive' },
      { name: JOURNAL_LOCK_NAME, mode: 'exclusive' },
    ]);
    expect(JOURNAL_LOCK_NAME).toBe(JOURNAL_STORAGE_KEY);
  });

  it('reports no lock when the browser has no Web Locks', () => {
    vi.stubGlobal('navigator', {});
    expect(browserJournalLock()).toBeNull();
  });
});
