import { z } from 'zod';
import type { VerifierRpc } from '@/lib/verify/rpc';
import { VerifierRpcError } from '@/lib/verify/rpc';
import type { JournalEntry, JournalStorage, SubmissionJournal } from './journal';

/**
 * Wallet redirect recovery (Phase 2D, priority B).
 *
 * Redirect-style NEAR wallets leave the app and come back to the callback URL
 * with `?transactionHashes=<h1>,<h2>` after signing, or `?errorCode=...` after a
 * decline. The in-memory promise that would have carried the hash is gone, but
 * the journal entry written BEFORE the wallet opened survives (journal.ts).
 *
 * This module:
 *  1. captures those parameters into a small persistent inbox and strips them
 *     from the address bar (so a reload or a shared URL does not replay them);
 *  2. binds each returned hash to a journal entry ONLY after reading the
 *     transaction from the chain and confirming signer, contract, method and
 *     request ID;
 *  3. never signs, never resubmits and never unblocks an attempt because a hash
 *     is missing. A lost reference leaves the entry blocking until a finalized
 *     contract read explains it (submit.ts `reconcile`), exactly as before.
 *
 * Query parameters are attacker-controllable (anyone can craft a link), so:
 *  - hashes are only hints; a hash that does not match a pending entry on chain
 *    is dropped, and a matching one only adds an explorer link and a reference
 *    for the receipt verifier, which re-checks everything itself;
 *  - an explicit decline can only move an AWAITING_SIGNATURE entry to
 *    USER_REJECTED. Even if forged, the worst case is a second wallet prompt the
 *    person must approve again; the contract accepts one funding per request,
 *    consumes each creation nonce once and checks retry nonces, so a duplicate
 *    can never move funds twice (sandbox-verified);
 *  - `errorMessage` is never stored or rendered.
 */

export const WALLET_RETURN_STORAGE_KEY = 'taply.wallet-return.v1';
/** A return older than this is no longer matched to anything. */
export const WALLET_RETURN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** An entry that started longer ago than this is not matched to a fresh return. */
const ENTRY_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 20;
/** Passes after which an unplaceable hash is given up on (the entry stays blocking). */
export const WALLET_RETURN_MAX_ATTEMPTS = 60;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RETURN_PARAMS = ['transactionHashes', 'errorCode', 'errorMessage'] as const;

export type WalletReturn =
  | { readonly kind: 'hashes'; readonly hashes: ReadonlyArray<string> }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'error' };

/** Reads wallet-return parameters. Malformed hashes make the whole return an `error`. */
export function parseWalletReturn(search: string): WalletReturn | null {
  const params = new URLSearchParams(search);
  const hashes = params.get('transactionHashes');
  const errorCode = params.get('errorCode');
  if (hashes !== null) {
    const list = hashes.split(',').filter((h) => h.length > 0);
    if (list.length === 0 || list.length > 8 || !list.every((h) => TX_HASH.test(h))) return { kind: 'error' };
    return { kind: 'hashes', hashes: [...new Set(list)] };
  }
  if (errorCode !== null) return errorCode === 'userRejected' ? { kind: 'rejected' } : { kind: 'error' };
  return null;
}

/** The same URL without wallet-return parameters (others and the fragment are kept). */
export function stripWalletReturn(href: string): string {
  const url = new URL(href);
  for (const name of RETURN_PARAMS) url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

const ItemSchema = z.strictObject({
  id: z.string().max(400),
  kind: z.enum(['hashes', 'rejected', 'error']),
  hashes: z.array(z.string().regex(TX_HASH)).max(8),
  receivedAt: z.iso.datetime({ offset: false }),
  attempts: z.number().int().min(0).max(1000),
});
type Item = z.infer<typeof ItemSchema>;
const InboxSchema = z.strictObject({ version: z.literal(1), items: z.array(ItemSchema).max(MAX_ITEMS) });

/** Persistent queue of wallet returns not yet explained. Survives reloads. */
export class WalletReturnInbox {
  constructor(
    private readonly storage: JournalStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  items(): Item[] {
    const raw = this.storage.getItem(WALLET_RETURN_STORAGE_KEY);
    if (raw === null) return [];
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
    const parsed = InboxSchema.safeParse(value);
    // A damaged inbox is dropped: it only ever held hints, never the brake itself.
    return parsed.success ? parsed.data.items : [];
  }

  /** Adds a return. The same return delivered twice (duplicate callback) is stored once. */
  add(ret: WalletReturn): void {
    const id =
      ret.kind === 'hashes' ? `hashes:${[...ret.hashes].sort().join(',')}` : `${ret.kind}:${this.now().toISOString()}`;
    const items = this.items();
    if (items.some((i) => i.id === id)) return;
    items.push({
      id,
      kind: ret.kind,
      hashes: ret.kind === 'hashes' ? [...ret.hashes] : [],
      receivedAt: this.now().toISOString(),
      attempts: 0,
    });
    this.write(items.slice(-MAX_ITEMS));
  }

  replace(items: Item[]): void {
    this.write(items);
  }

  private write(items: Item[]): void {
    this.storage.setItem(WALLET_RETURN_STORAGE_KEY, JSON.stringify({ version: 1, items }));
  }
}

/** Captures a wallet return from the current URL, then strips it. Returns true if one was found. */
export function captureWalletReturn(
  inbox: WalletReturnInbox,
  location: { readonly href: string; readonly search: string },
  replaceUrl: (url: string) => void,
): boolean {
  const ret = parseWalletReturn(location.search);
  if (ret === null) return false;
  inbox.add(ret);
  replaceUrl(stripWalletReturn(location.href));
  return true;
}

export type TransactionMatch = 'match' | 'mismatch' | 'unknown';

const TxBodySchema = z.object({
  transaction: z.object({
    hash: z.string(),
    signer_id: z.string(),
    receiver_id: z.string(),
    actions: z.array(z.unknown()).max(64),
  }),
});
const FunctionCallSchema = z.object({
  FunctionCall: z.object({ method_name: z.string(), args: z.string().max(16_384) }),
});

/** Request ID a journaled call refers to, from its decoded JSON arguments. */
function requestIdOf(method: JournalEntry['method'], args: unknown): string | null {
  if (typeof args !== 'object' || args === null) return null;
  const record = args as Record<string, unknown>;
  if (method === 'create_request') {
    const terms = record['terms'];
    if (typeof terms !== 'object' || terms === null) return null;
    const id = (terms as Record<string, unknown>)['id'];
    return typeof id === 'string' ? id : null;
  }
  const id = record['id'];
  return typeof id === 'string' ? id : null;
}

/**
 * Reads `hash` as sent by `entry.signerAccountId` and says whether it is exactly
 * the journaled call: same signer, same contract, one function call of the same
 * method for the same request. `unknown` means the chain cannot say yet.
 */
export async function matchTransaction(rpc: VerifierRpc, hash: string, entry: JournalEntry): Promise<TransactionMatch> {
  let raw: unknown;
  try {
    raw = await rpc.call('EXPERIMENTAL_tx_status', {
      tx_hash: hash,
      sender_account_id: entry.signerAccountId,
      wait_until: 'INCLUDED',
    });
  } catch (error) {
    // Unknown to this node (yet), network trouble: no conclusion either way.
    if (error instanceof VerifierRpcError && error.code === 'MALFORMED') return 'mismatch';
    return 'unknown';
  }
  const parsed = TxBodySchema.safeParse(raw);
  if (!parsed.success) return 'unknown';
  const tx = parsed.data.transaction;
  if (tx.hash !== hash || tx.signer_id !== entry.signerAccountId || tx.receiver_id !== entry.contractId)
    return 'mismatch';
  if (tx.actions.length !== 1) return 'mismatch';
  const call = FunctionCallSchema.safeParse(tx.actions[0]);
  if (!call.success || call.data.FunctionCall.method_name !== entry.method) return 'mismatch';
  let args: unknown;
  try {
    args = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64Bytes(call.data.FunctionCall.args)));
  } catch {
    return 'mismatch';
  }
  return requestIdOf(entry.method, args) === entry.requestId ? 'match' : 'mismatch';
}

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Entries a wallet return could belong to: unexplained, hash-less, recent. */
function candidates(journal: SubmissionJournal, now: Date): JournalEntry[] {
  return journal
    .entries()
    .filter(
      (e) =>
        (e.phase === 'AWAITING_SIGNATURE' || e.phase === 'OUTCOME_UNKNOWN') &&
        e.transactionHash === null &&
        now.getTime() - Date.parse(e.startedAt) <= ENTRY_MATCH_WINDOW_MS,
    );
}

export interface ProcessResult {
  /** True when the journal changed and screens should re-read it. */
  readonly journalChanged: boolean;
  /** Returns still waiting for the chain (kept in the inbox for a later pass). */
  readonly pending: number;
}

/**
 * Explains queued wallet returns against the journal and the chain. Safe to run
 * any number of times (reloads, duplicate callbacks): bound entries are no
 * longer candidates, and processed returns leave the inbox.
 */
export async function processWalletReturns(input: {
  readonly inbox: WalletReturnInbox;
  readonly journal: SubmissionJournal;
  readonly rpc: VerifierRpc | null;
  readonly now?: () => Date;
}): Promise<ProcessResult> {
  const { inbox, journal, rpc } = input;
  const now = (input.now ?? (() => new Date()))();
  if (!journal.isReadable()) return { journalChanged: false, pending: inbox.items().length };
  let journalChanged = false;
  const keep: Item[] = [];

  for (const item of inbox.items()) {
    // Stale returns are forgotten; their entries stay blocking until the chain explains them.
    if (now.getTime() - Date.parse(item.receivedAt) > WALLET_RETURN_MAX_AGE_MS) continue;
    if (item.attempts >= WALLET_RETURN_MAX_ATTEMPTS) continue;
    const open = candidates(journal, now);

    if (item.kind === 'rejected') {
      // Only an attempt still waiting for the wallet can have been declined, and
      // only when exactly one is waiting: otherwise the decline cannot be attributed.
      const awaiting = open.filter((e) => e.phase === 'AWAITING_SIGNATURE');
      const [only] = awaiting;
      if (only !== undefined && awaiting.length === 1) {
        await journal.update(only, { phase: 'USER_REJECTED' });
        journalChanged = true;
      }
      continue;
    }
    if (item.kind === 'error') {
      // The wallet came back with an unexplained error: something may have been
      // sent. Waiting attempts become OUTCOME_UNKNOWN (still blocking).
      for (const e of open.filter((x) => x.phase === 'AWAITING_SIGNATURE')) {
        await journal.update(e, { phase: 'OUTCOME_UNKNOWN' });
        journalChanged = true;
      }
      continue;
    }

    // Hashes: the wallet says it broadcast something. Until bound, waiting
    // attempts are at least OUTCOME_UNKNOWN; nothing becomes unblocked here.
    for (const e of open.filter((x) => x.phase === 'AWAITING_SIGNATURE')) {
      await journal.update(e, { phase: 'OUTCOME_UNKNOWN' });
      journalChanged = true;
    }
    if (rpc === null) {
      keep.push({ ...item, attempts: item.attempts + 1 });
      continue;
    }
    const unbound: string[] = [];
    for (const hash of item.hashes) {
      let bound = false;
      let undecided = false;
      for (const entry of candidates(journal, now)) {
        const verdict = await matchTransaction(rpc, hash, entry);
        if (verdict === 'match') {
          await journal.update(entry, { phase: 'SUBMITTED', transactionHash: hash });
          journalChanged = true;
          bound = true;
          break;
        }
        if (verdict === 'unknown') undecided = true;
      }
      // A hash no pending entry claims is dropped; one the chain cannot place yet is retried later.
      if (!bound && undecided) unbound.push(hash);
    }
    if (unbound.length > 0) keep.push({ ...item, hashes: unbound, attempts: item.attempts + 1 });
  }

  inbox.replace(keep);
  return { journalChanged, pending: keep.length };
}
