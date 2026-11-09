import { z } from 'zod';
import type { ContractRequest } from '@/lib/protocol';
import { VerifierRpcError } from './rpc';
import type { LocatorRpc } from './rpc';

/**
 * Phase 7G: find the funding transaction of a paid request from public chain
 * data, so the merchant's phone can run the independent receipt verifier
 * without waiting for the customer's verification link.
 *
 * Why this is possible: the contract records `fundedAtNs`, which is exactly the
 * timestamp of the block whose chunk executed the payer's `pay_instant_native`
 * receipt (the verifier already requires that equality, check 8). The signed
 * transaction that created that receipt was included in a chunk of that block
 * or of one of the few blocks just before it.
 *
 * What this does, read-only, through the configured RPC (`block`, `chunk`):
 *   1. read the latest final block;
 *   2. interpolation-search block heights for the block whose timestamp equals
 *      `fundedAtNs` exactly;
 *   3. scan the new chunks of that block and of up to three blocks before it
 *      for a transaction signed by the recorded payer, sent to the contract,
 *      with ONE `pay_instant_native` call whose `id` is this request.
 *
 * What it is NOT: proof. A located hash is a CANDIDATE, exactly like the hash in
 * a verification link (`?ftx=`). It only tells the verifier where to look; the
 * verifier then checks the whole transaction, its receipts, code hash, timing
 * and access keys against the chain. A wrong candidate can only produce "not
 * verified", never "verified". There is no indexer, no server and no guess: if
 * the chain search does not find a match, the result says so.
 *
 * Bounded: at most `maxCalls` RPC calls (default 48). Pruned history (a
 * non-archival RPC more than ~2 days later) returns `history_unavailable`.
 * Payouts that needed a retry are out of scope (the verifier would also need
 * each retry hash), so those return `not_applicable`.
 */

export type LocateResult =
  | { readonly kind: 'found'; readonly candidates: ReadonlyArray<string>; readonly blockHeight: number; readonly calls: number }
  | { readonly kind: 'not_found'; readonly calls: number }
  | { readonly kind: 'history_unavailable'; readonly calls: number }
  | { readonly kind: 'unavailable'; readonly calls: number }
  /** The RPC asked us to slow down (HTTP 429). Nothing was learned; search again after `retryAfterMs`. */
  | { readonly kind: 'rate_limited'; readonly calls: number; readonly retryAfterMs: number }
  | { readonly kind: 'budget_exhausted'; readonly calls: number }
  | {
      readonly kind: 'not_applicable';
      readonly reason: 'not_final_paid' | 'needs_retry_references' | 'missing_funding_facts';
    };

export interface LocateInput {
  readonly rpc: LocatorRpc;
  readonly contractId: string;
  readonly request: ContractRequest;
  readonly maxCalls?: number;
  /** Blocks before the funding block to scan for the transaction (default 3). */
  readonly blocksBack?: number;
}

export const DEFAULT_MAX_LOCATOR_CALLS = 48;
const DEFAULT_BLOCKS_BACK = 3;
const MAX_CANDIDATES = 3;
/** Testnet/Mainnet block production is at least this fast on average (0.6 s target today). */
const MIN_BLOCK_NS = 400_000_000n;
/** Heights can be skipped; look at most this many heights ahead for an existing block. */
const MAX_GAP = 4;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const Int = z.number().int().nonnegative();
const Decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);

const BlockSchema = z.object({
  header: z.object({ height: Int, timestamp_nanosec: Decimal }),
  chunks: z
    .array(z.object({ chunk_hash: z.string().min(32).max(64), height_included: Int }))
    .max(64),
});
type Block = { readonly height: number; readonly timestampNs: bigint; readonly chunks: ReadonlyArray<{ readonly hash: string; readonly included: number }> };

const ChunkSchema = z.object({
  transactions: z
    .array(
      z.object({
        hash: z.string(),
        signer_id: z.string(),
        receiver_id: z.string(),
        actions: z.array(z.unknown()).max(128),
      }),
    )
    .max(4096),
});

class Exhausted extends Error {}

export async function locateFundingTransaction(input: LocateInput): Promise<LocateResult> {
  const { rpc, contractId, request } = input;
  if (request.status !== 'FINAL_PAID') return { kind: 'not_applicable', reason: 'not_final_paid' };
  if (request.payerAccountId === null || request.fundedAtNs === null || request.latestOperation === null) {
    return { kind: 'not_applicable', reason: 'missing_funding_facts' };
  }
  if (request.latestOperation.nonce !== '1') return { kind: 'not_applicable', reason: 'needs_retry_references' };

  const maxCalls = input.maxCalls ?? DEFAULT_MAX_LOCATOR_CALLS;
  const blocksBack = input.blocksBack ?? DEFAULT_BLOCKS_BACK;
  const target = BigInt(request.fundedAtNs);
  const payer = request.payerAccountId;
  const requestId = request.terms.id;
  let calls = 0;

  const call = async (method: 'block' | 'chunk', params: unknown): Promise<unknown> => {
    if (calls >= maxCalls) throw new Exhausted();
    calls += 1;
    return rpc.call(method, params);
  };

  /** The block at `height`, or the next existing one within MAX_GAP heights; null if none. */
  const blockAtOrAfter = async (height: number, limit: number): Promise<Block | null> => {
    for (let h = height; h <= Math.min(height + MAX_GAP, limit); h++) {
      try {
        return parseBlock(await call('block', { block_id: h }));
      } catch (error) {
        // A skipped height is normal; an unknown (pruned) block below the
        // retained window is reported by the caller as history_unavailable.
        if (error instanceof VerifierRpcError && error.code === 'UNKNOWN_BLOCK') continue;
        throw error;
      }
    }
    return null;
  };

  try {
    const final = parseBlock(await call('block', { finality: 'final' }));
    if (target > final.timestampNs) return { kind: 'not_found', calls };

    // Lower bound: no more blocks than elapsed time allows at the fastest rate.
    const span = heightOf((final.timestampNs - target) / MIN_BLOCK_NS + 2n);
    let hi: Block = final;
    let lo: Block | null = null;
    let loGuess = Math.max(0, final.height - span);
    for (let attempt = 0; attempt < 3 && lo === null; attempt++) {
      const candidate = await blockAtOrAfter(loGuess, hi.height);
      if (candidate === null) {
        // Pruned (or a long gap): nothing older than this is available here.
        return { kind: 'history_unavailable', calls };
      }
      if (candidate.timestampNs <= target) lo = candidate;
      else {
        hi = candidate;
        loGuess = Math.max(0, loGuess - span);
      }
    }
    if (lo === null) return { kind: 'not_found', calls };

    let found: Block | null = lo.timestampNs === target ? lo : hi.timestampNs === target ? hi : null;
    while (found === null && hi.height - lo.height > 1) {
      // Interpolate on time; fall back to bisection if it would not shrink the range.
      // Exact integer interpolation on ns timestamps (BigInt, floor division).
      const range = BigInt(hi.height - lo.height);
      let guess = lo.height + heightOf(((target - lo.timestampNs) * range) / (hi.timestampNs - lo.timestampNs));
      if (guess <= lo.height || guess >= hi.height) guess = lo.height + Math.floor((hi.height - lo.height) / 2);
      const block = await blockAtOrAfter(guess, hi.height - 1);
      if (block === null) {
        // No block between guess and hi: shrink from below with bisection instead.
        const mid = lo.height + Math.floor((guess - lo.height) / 2);
        if (mid <= lo.height) break;
        const lower = await blockAtOrAfter(mid, guess - 1);
        if (lower === null) break;
        if (lower.timestampNs === target) found = lower;
        else if (lower.timestampNs < target) lo = lower;
        else hi = lower;
        continue;
      }
      if (block.timestampNs === target) found = block;
      else if (block.timestampNs < target) lo = block;
      else hi = block;
    }
    if (found === null) return { kind: 'not_found', calls };

    // The transaction usually sits one block before the receipt that executed it.
    const order = [found.height - 1, found.height, ...Array.from({ length: Math.max(0, blocksBack - 1) }, (_, i) => found.height - 2 - i)];
    for (const height of order) {
      if (height < 0) continue;
      let block: Block | null;
      if (height === found.height) block = found;
      else {
        try {
          block = parseBlock(await call('block', { block_id: height }));
        } catch (error) {
          if (error instanceof VerifierRpcError && error.code === 'UNKNOWN_BLOCK') continue;
          throw error;
        }
      }
      const candidates: string[] = [];
      for (const chunk of block.chunks) {
        // Only chunks produced at this height carry new transactions.
        if (chunk.included !== block.height) continue;
        const parsed = ChunkSchema.safeParse(await call('chunk', { chunk_id: chunk.hash }));
        if (!parsed.success) continue;
        for (const tx of parsed.data.transactions) {
          if (isFundingCandidate(tx, { payer, contractId, requestId }) && !candidates.includes(tx.hash)) candidates.push(tx.hash);
        }
      }
      if (candidates.length > 0) {
        return { kind: 'found', candidates: candidates.slice(0, MAX_CANDIDATES), blockHeight: block.height, calls };
      }
    }
    return { kind: 'not_found', calls };
  } catch (error) {
    if (error instanceof Exhausted) return { kind: 'budget_exhausted', calls };
    if (error instanceof VerifierRpcError && error.code === 'UNKNOWN_BLOCK') return { kind: 'history_unavailable', calls };
    if (error instanceof VerifierRpcError && error.code === 'RATE_LIMITED') {
      return { kind: 'rate_limited', calls, retryAfterMs: error.retryAfterMs ?? 0 };
    }
    return { kind: 'unavailable', calls };
  }
}

/**
 * A block-height delta computed in BigInt. Heights are JSON numbers in the RPC
 * (safe integers, checked by assertSafeNumbers); this is never an amount or a
 * timestamp. Out-of-range values are clamped so the search simply ends.
 */
function heightOf(value: bigint): number {
  if (value < 0n) return 0;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number.parseInt(value.toString(), 10);
}

function parseBlock(raw: unknown): Block {
  const parsed = BlockSchema.safeParse(raw);
  if (!parsed.success) throw new VerifierRpcError('MALFORMED');
  return {
    height: parsed.data.header.height,
    timestampNs: BigInt(parsed.data.header.timestamp_nanosec),
    chunks: parsed.data.chunks.map((c) => ({ hash: c.chunk_hash, included: c.height_included })),
  };
}

/** Signed by the payer, sent to the contract, exactly ONE pay_instant_native call for this ID. */
export function isFundingCandidate(
  tx: { readonly hash: string; readonly signer_id: string; readonly receiver_id: string; readonly actions: ReadonlyArray<unknown> },
  expected: { readonly payer: string; readonly contractId: string; readonly requestId: string },
): boolean {
  if (!TX_HASH.test(tx.hash) || tx.signer_id !== expected.payer || tx.receiver_id !== expected.contractId) return false;
  if (tx.actions.length !== 1) return false;
  const action = tx.actions[0];
  if (typeof action !== 'object' || action === null || !('FunctionCall' in action)) return false;
  const fc = (action as { FunctionCall: unknown }).FunctionCall;
  if (typeof fc !== 'object' || fc === null) return false;
  const { method_name: method, args } = fc as { method_name?: unknown; args?: unknown };
  if (method !== 'pay_instant_native' || typeof args !== 'string' || args.length > 4096) return false;
  try {
    const decoded: unknown = JSON.parse(atob(args));
    return typeof decoded === 'object' && decoded !== null && (decoded as { id?: unknown }).id === expected.requestId;
  } catch {
    return false;
  }
}

/** Results that say nothing about the chain (provider trouble), so another provider may be asked. */
const TRANSIENT_LOCATE: ReadonlySet<LocateResult['kind']> = new Set(['unavailable', 'history_unavailable', 'rate_limited', 'budget_exhausted']);

/**
 * Runs the WHOLE search on each provider in turn, moving on only after a transient
 * result (real payment 7nb5J2Ss…: a single failed provider left the recipient on
 * "Could not search the chain"). `found` / `not_found` / `not_applicable` are final.
 * A found hash stays a candidate: the independent verifier still has to prove it.
 */
export async function locateAcrossProviders(
  input: Omit<LocateInput, 'rpc'>,
  rpcs: ReadonlyArray<LocatorRpc>,
  locate: (input: LocateInput) => Promise<LocateResult> = locateFundingTransaction,
): Promise<LocateResult> {
  let last: LocateResult = { kind: 'unavailable', calls: 0 };
  for (const rpc of rpcs) {
    last = await locate({ ...input, rpc });
    if (!TRANSIENT_LOCATE.has(last.kind)) return last;
  }
  return last;
}
