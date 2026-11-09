import { z } from 'zod';
import { AccountIdSchema, HashHexSchema, IntentTermsSchema } from '@/lib/protocol';
import type { JournalLock } from './journal-lock';

/**
 * Local submission journal (freeze section 9, API.md "Journal creation nonce,
 * ID, network, intended method and terms hash before redirect").
 *
 * Written BEFORE a wallet opens, so a reload, redirect or crash mid-signature
 * still knows an attempt may exist. It holds only public data: request IDs,
 * terms, hashes, account IDs and transaction hashes. Never keys, seeds or
 * signatures.
 *
 * The journal is a safety brake, not a source of truth. An entry never makes
 * anything "paid"; it only blocks a second attempt until a finalized chain read
 * explains what happened to the first one.
 */

export const JOURNAL_STORAGE_KEY = 'taply.journal.v1';

export const JOURNAL_METHODS = [
  'create_request',
  'pay_instant_native',
  'retry_native_transfer',
  'cancel_unfunded',
  // Protected Pay (G3 candidate). Only reachable behind the protectedPay flag.
  'fund_protected_native',
  'cancel_protected',
  'release_protected',
] as const;
export type JournalMethod = (typeof JOURNAL_METHODS)[number];

/**
 * AWAITING_SIGNATURE  wallet opened; nothing known yet
 * USER_REJECTED       nonblocking only with local notDispatched evidence
 * OUTCOME_UNKNOWN     the wallet may have broadcast; only the chain can tell
 * SUBMITTED           the wallet returned a transaction hash; the chain decides the result
 * RESOLVED            a finalized read explained the attempt; it no longer blocks
 */
export const JOURNAL_PHASES = ['AWAITING_SIGNATURE', 'USER_REJECTED', 'OUTCOME_UNKNOWN', 'SUBMITTED', 'RESOLVED'] as const;
export type JournalPhase = (typeof JOURNAL_PHASES)[number];

const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const JournalEntrySchema = z.strictObject({
  method: z.enum(JOURNAL_METHODS),
  network: z.literal('near-testnet'),
  contractId: AccountIdSchema,
  requestId: HashHexSchema,
  termsHash: HashHexSchema,
  signerAccountId: AccountIdSchema,
  /** Public immutable terms retained for reconciliation after redirect/reload. */
  terms: IntentTermsSchema.nullable(),
  /** retry_native_transfer: the recorded failure nonce it targeted. */
  operationNonce: z.string().regex(/^[1-9][0-9]{0,19}$/).nullable(),
  phase: z.enum(JOURNAL_PHASES),
  /** Only local pre-dispatch checks may supply this; absent in legacy records. */
  notDispatched: z.literal(true).optional(),
  transactionHash: z.string().regex(TX_HASH).nullable(),
  startedAt: z.iso.datetime({ offset: false }),
  updatedAt: z.iso.datetime({ offset: false }),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

const JournalSchema = z.strictObject({ version: z.literal(1), entries: z.array(JournalEntrySchema).max(200) });

export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Unresolved phases block a new attempt for the same request/method/signer. */
export function isBlocking(entry: JournalEntry): boolean {
  return entry.phase !== 'RESOLVED' && !(entry.phase === 'USER_REJECTED' && entry.notDispatched === true && entry.transactionHash === null);
}

function keyOf(entry: Pick<JournalEntry, 'requestId' | 'method' | 'signerAccountId'>): string {
  return `${entry.requestId}:${entry.method}:${entry.signerAccountId}`;
}

export class SubmissionJournal {
  /**
   * `lock` serialises writes across tabs (see journal-lock.ts). Without one,
   * `begin` refuses (no new wallet prompt) and `update` writes unlocked so an
   * outcome is never lost.
   */
  constructor(
    private readonly storage: JournalStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly lock: JournalLock | null = null,
  ) {}

  /** True when new attempts can be recorded safely (a cross-tab lock exists). */
  canBegin(): boolean {
    return this.lock !== null;
  }

  /**
   * Reads every valid entry. A corrupted store is treated as "unknown" by the
   * caller (see `isReadable`), never silently as "no attempts".
   */
  entries(): JournalEntry[] {
    const raw = this.storage.getItem(JOURNAL_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JournalSchema.safeParse(safeJson(raw));
    if (!parsed.success) throw new JournalCorruptError();
    // Older versions inferred rejection from SDK text. Preserve these attempts
    // as unknown across reloads; no timeout or migration may erase the brake.
    return parsed.data.entries.map(entry => entry.phase === 'USER_REJECTED' && isBlocking(entry)
      ? { ...entry, phase: 'OUTCOME_UNKNOWN' as const } : entry);
  }

  isReadable(): boolean {
    try {
      this.entries();
      return true;
    } catch {
      return false;
    }
  }

  find(requestId: string, method: JournalMethod, signerAccountId: string): JournalEntry | null {
    return this.entries().find((e) => keyOf(e) === keyOf({ requestId, method, signerAccountId })) ?? null;
  }

  /** All entries for a request, newest first. */
  forRequest(requestId: string): JournalEntry[] {
    return this.entries()
      .filter((e) => e.requestId === requestId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Records the intent to sign. Refuses while an earlier attempt for the same
   * request/method/signer is still unexplained: that is the duplicate brake.
   *
   * Runs under the journal lock and re-reads storage inside it, so another tab
   * that began the same attempt a moment earlier is seen and this one is
   * blocked before any wallet opens.
   */
  async begin(
    entry: Omit<JournalEntry, 'phase' | 'transactionHash' | 'startedAt' | 'updatedAt'>,
  ): Promise<JournalEntry> {
    if (this.lock === null) throw new JournalUnavailableError();
    return this.lock.run(() => this.beginLocked(entry));
  }

  private beginLocked(entry: Omit<JournalEntry, 'phase' | 'transactionHash' | 'startedAt' | 'updatedAt'>): JournalEntry {
    // The creation gate is account-wide, including a second tab that prepared a
    // different nonce before the first wallet answered. Enforce it under the
    // same lock as the write, not only in asynchronous screen state.
    if (entry.method === 'create_request') {
      const unexplained = this.entries().find(e => e.method === 'create_request' &&
        e.network === entry.network && e.contractId === entry.contractId &&
        e.signerAccountId === entry.signerAccountId && isBlocking(e));
      if (unexplained) throw new JournalBlockedError(unexplained);
    }
    const existing = this.find(entry.requestId, entry.method, entry.signerAccountId);
    if (existing !== null && isBlocking(existing)) throw new JournalBlockedError(existing);
    // startedAt also identifies this attempt. Two consecutive attempts in the
    // same millisecond must not share an identity.
    const at = new Date(Math.max(this.now().getTime(), existing === null ? 0 : Date.parse(existing.startedAt) + 1)).toISOString();
    const next = JournalEntrySchema.parse({
      ...entry,
      phase: 'AWAITING_SIGNATURE',
      transactionHash: null,
      startedAt: at,
      updatedAt: at,
    });
    this.write([...this.entries().filter((e) => keyOf(e) !== keyOf(next)), next]);
    return next;
  }

  /** Changes one entry. Re-reads storage under the lock so other tabs' entries survive. */
  async update(
    target: Pick<JournalEntry, 'requestId' | 'method' | 'signerAccountId'> & Partial<Pick<JournalEntry, 'startedAt'>>,
    change: { readonly phase: JournalPhase; readonly transactionHash?: string | null; readonly notDispatched?: true },
  ): Promise<JournalEntry> {
    if (this.lock === null) return this.updateLocked(target, change);
    return this.lock.run(() => this.updateLocked(target, change));
  }

  private updateLocked(
    target: Pick<JournalEntry, 'requestId' | 'method' | 'signerAccountId'> & Partial<Pick<JournalEntry, 'startedAt'>>,
    change: { readonly phase: JournalPhase; readonly transactionHash?: string | null; readonly notDispatched?: true },
  ): JournalEntry {
    const entries = this.entries();
    const index = entries.findIndex((e) => keyOf(e) === keyOf(target));
    const current = entries[index];
    if (current === undefined) throw new Error('journal entry missing');
    if (target.startedAt !== undefined && current.startedAt !== target.startedAt) throw new Error('journal attempt superseded');
    const next = JournalEntrySchema.parse({
      ...current,
      ...(change.notDispatched === true ? { notDispatched: true as const } : {}),
      // Once a finalized read explained an attempt it stays explained: a late
      // wallet outcome or redirect only attaches its hash (Phase 6A). Only a new
      // `begin` replaces a RESOLVED entry.
      phase: current.phase === 'RESOLVED' ? 'RESOLVED'
        : current.transactionHash !== null && (change.phase === 'USER_REJECTED' || change.phase === 'OUTCOME_UNKNOWN')
          ? current.phase : change.phase,
      // A known hash is never forgotten by a later update.
      transactionHash: current.transactionHash ?? change.transactionHash ?? null,
      updatedAt: this.now().toISOString(),
    });
    entries[index] = next;
    this.write(entries);
    return next;
  }

  private write(entries: JournalEntry[]): void {
    // At most 200 entries. Trimming drops the oldest RESOLVED entries only; an
    // unexplained attempt is never forgotten to make room.
    const kept = [...entries];
    const resolvedOldestFirst = kept
      .filter((e) => e.phase === 'RESOLVED')
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const oldest of resolvedOldestFirst) {
      if (kept.length <= 200) break;
      kept.splice(kept.indexOf(oldest), 1);
    }
    if (kept.length > 200) throw new JournalFullError();
    this.storage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify({ version: 1, entries: kept }));
  }
}

export class JournalBlockedError extends Error {
  constructor(readonly entry: JournalEntry) {
    super('journal:blocked');
    this.name = 'JournalBlockedError';
  }
}

/** No cross-tab lock: a new attempt cannot be recorded safely. Nothing was sent. */
export class JournalUnavailableError extends Error {
  constructor() {
    super('journal:unavailable');
    this.name = 'JournalUnavailableError';
  }
}

export class JournalFullError extends Error {
  constructor() {
    super('journal:full');
    this.name = 'JournalFullError';
  }
}

export class JournalCorruptError extends Error {
  constructor() {
    super('journal:corrupt');
    this.name = 'JournalCorruptError';
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
