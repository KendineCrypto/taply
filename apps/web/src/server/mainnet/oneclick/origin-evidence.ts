/**
 * Base (origin chain) evidence for releasing an expired 1Click attempt.
 *
 * 1Click's status is an upstream CLAIM. Before Taply lets a request get a new
 * payable deposit address, the old address must be shown by the Base chain
 * itself, at a FINALIZED block, to be in one of two states:
 *
 *  - never funded: no USDC Transfer to the deposit address from shortly
 *    before the quote was created up to a finalized block that is later than
 *    the quote deadline + grace;
 *  - funded and refunded: every USDC Transfer into the deposit address happened
 *    before the refund, and the refund transaction(s) reported by 1Click are
 *    successful, finalized, and contain a USDC Transfer to the quote's refund
 *    address whose total equals the reported refunded amount.
 *
 * Anything else (RPC error, range too large, not final yet, a deposit 1Click
 * has not reported, a refund to another address, an amount mismatch, a deposit
 * after the refund) is NOT evidence, and the attempt stays blocked.
 *
 * Server only. Bounded JSON-RPC: fixed URL from server env, POST, no redirects,
 * no cache, timeout, response size cap, upstream error text never forwarded.
 */
import { z } from 'zod';
import { boundedText } from './bounded-body';

export const BASE_USDC_CONTRACT = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** Base produces a block every 2 s; used only to choose a conservative lower search bound. */
export const BASE_BLOCK_MS = 2_000;
/** Search starts this long before the quote was created (clock skew, reorg margin). */
export const SEARCH_MARGIN_MS = 20 * 60_000;
export const LOG_CHUNK_BLOCKS = 1_000;
/** At most this many log windows per proof (~66 h of Base blocks); larger ranges are not evidence. */
export const MAX_LOG_CHUNKS = 120;

export class OriginRpcError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'RPC_ERROR' | 'MALFORMED' | 'RANGE_TOO_LARGE') { super(`ORIGIN_${code}`); }
}

export interface BaseRpc { call(method: string, params: ReadonlyArray<unknown>): Promise<unknown> }

export function createBaseRpc(input: { readonly url: string; readonly fetcher?: typeof fetch; readonly timeoutMs?: number; readonly maxBytes?: number }): BaseRpc {
  const fetcher = input.fetcher ?? ((u, i) => globalThis.fetch(u, i));
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxBytes = input.maxBytes ?? 1_048_576;
  let id = 0;
  return {
    async call(method, params) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(input.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'taply-server' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new OriginRpcError('UNAVAILABLE'); }
        const text = await boundedText(response.body, maxBytes, controller.signal);
        const body = JSON.parse(text) as { result?: unknown; error?: unknown };
        if (body.error !== undefined) throw new OriginRpcError('RPC_ERROR');
        if (!('result' in body)) throw new OriginRpcError('MALFORMED');
        return body.result;
      } catch (error) {
        throw error instanceof OriginRpcError ? error : new OriginRpcError('UNAVAILABLE');
      } finally { clearTimeout(timer); }
    },
  };
}

const Hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const Hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Block = z.object({ number: Hex, timestamp: Hex, hash: Hash });
const Log = z.object({ address: z.string(), topics: z.array(z.string()).max(4), data: Hex, blockNumber: Hex, transactionHash: Hash, removed: z.boolean().optional() });
const Receipt = z.object({ status: Hex, blockNumber: Hex, transactionHash: Hash, logs: z.array(Log).max(512) });
const big = (h: string) => BigInt(h);
const pad = (address: string) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

export interface FinalBlock { readonly number: bigint; readonly timestampMs: bigint }
export async function finalizedBlock(rpc: BaseRpc): Promise<FinalBlock> {
  // A configured URL is not proof that the provider serves Base Mainnet.
  if (await rpc.call('eth_chainId', []) !== '0x2105') throw new OriginRpcError('MALFORMED');
  const parsed = Block.safeParse(await rpc.call('eth_getBlockByNumber', ['finalized', false]));
  if (!parsed.success) throw new OriginRpcError('MALFORMED');
  return { number: big(parsed.data.number), timestampMs: big(parsed.data.timestamp) * 1000n };
}

/** Conservative first block: at least SEARCH_MARGIN before `sinceMs`, assuming no block is faster than BASE_BLOCK_MS. */
export function searchFrom(final: FinalBlock, sinceMs: number): bigint {
  const span = final.timestampMs - BigInt(sinceMs - SEARCH_MARGIN_MS);
  const back = span <= 0n ? 0n : (span + BigInt(BASE_BLOCK_MS) - 1n) / BigInt(BASE_BLOCK_MS);
  return final.number > back ? final.number - back : 0n;
}

interface Transfer { readonly amount: bigint; readonly block: bigint; readonly tx: string }
function transferValue(log: z.infer<typeof Log>, to: string): bigint | null {
  if (log.removed === true || log.address.toLowerCase() !== BASE_USDC_CONTRACT) return null;
  if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics[2]?.toLowerCase() !== pad(to)) return null;
  return big(log.data);
}

/** Every USDC Transfer to `to` in [from, to] (inclusive), in bounded windows. */
export async function usdcTransfersTo(rpc: BaseRpc, to: string, fromBlock: bigint, toBlock: bigint): Promise<ReadonlyArray<Transfer>> {
  if (!isAddress(to)) throw new OriginRpcError('MALFORMED');
  const span = toBlock - fromBlock + 1n;
  if (span <= 0n) return [];
  if (span > BigInt(LOG_CHUNK_BLOCKS * MAX_LOG_CHUNKS)) throw new OriginRpcError('RANGE_TOO_LARGE');
  const out: Transfer[] = [];
  for (let start = fromBlock; start <= toBlock; start += BigInt(LOG_CHUNK_BLOCKS)) {
    const end = start + BigInt(LOG_CHUNK_BLOCKS - 1) < toBlock ? start + BigInt(LOG_CHUNK_BLOCKS - 1) : toBlock;
    const raw = await rpc.call('eth_getLogs', [{ address: BASE_USDC_CONTRACT, topics: [TRANSFER_TOPIC, null, pad(to)], fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }]);
    const logs = z.array(Log).max(10_000).safeParse(raw);
    if (!logs.success) throw new OriginRpcError('MALFORMED');
    for (const log of logs.data) {
      const value = transferValue(log, to);
      const block = big(log.blockNumber);
      // A provider that returns logs outside the requested window is not trusted.
      if (block < start || block > end) throw new OriginRpcError('MALFORMED');
      if (value !== null) out.push({ amount: value, block, tx: log.transactionHash.toLowerCase() });
    }
  }
  return out;
}

export type NoDepositProof =
  | { readonly ok: true; readonly fromBlock: string; readonly finalizedBlock: string }
  | { readonly ok: false; readonly reason: 'NOT_FINAL_YET' | 'DEPOSIT_FOUND' };
export async function proveNoDeposit(rpc: BaseRpc, input: { readonly depositAddress: string; readonly createdAtMs: number; readonly mustCoverUntilMs: number }): Promise<NoDepositProof> {
  const final = await finalizedBlock(rpc);
  if (final.timestampMs <= BigInt(input.mustCoverUntilMs)) return { ok: false, reason: 'NOT_FINAL_YET' };
  const from = searchFrom(final, input.createdAtMs);
  const deposits = await usdcTransfersTo(rpc, input.depositAddress, from, final.number);
  if (deposits.length > 0) return { ok: false, reason: 'DEPOSIT_FOUND' };
  return { ok: true, fromBlock: from.toString(), finalizedBlock: final.number.toString() };
}

export type RefundProof =
  | { readonly ok: true; readonly deposited: string; readonly refunded: string; readonly refundTxs: ReadonlyArray<string>; readonly finalizedBlock: string }
  | { readonly ok: false; readonly reason: 'NO_DEPOSIT_FOUND' | 'REFUND_NOT_FOUND' | 'REFUND_NOT_FINAL' | 'REFUND_AMOUNT_MISMATCH' | 'REFUND_EXCEEDS_DEPOSIT' | 'REFUND_INCOMPLETE' | 'DEPOSIT_AFTER_REFUND' };
export async function proveRefund(rpc: BaseRpc, input: {
  readonly depositAddress: string; readonly refundTo: string; readonly createdAtMs: number;
  readonly reportedTxHashes: ReadonlyArray<string>; readonly reportedRefundedAmount: string | null;
}): Promise<RefundProof> {
  if (!isAddress(input.refundTo) || !isAddress(input.depositAddress)) throw new OriginRpcError('MALFORMED');
  const final = await finalizedBlock(rpc);
  const deposits = await usdcTransfersTo(rpc, input.depositAddress, searchFrom(final, input.createdAtMs), final.number);
  if (deposits.length === 0) return { ok: false, reason: 'NO_DEPOSIT_FOUND' };
  let refunded = 0n;
  let firstRefundBlock: bigint | null = null;
  const refundTxs: string[] = [];
  for (const hash of [...new Set(input.reportedTxHashes.map(h => h.toLowerCase()))].slice(0, 10)) {
    if (!Hash.safeParse(hash).success) continue;
    const receipt = Receipt.safeParse(await rpc.call('eth_getTransactionReceipt', [hash]));
    if (!receipt.success || receipt.data.transactionHash.toLowerCase() !== hash || big(receipt.data.status) !== 1n) continue;
    let amount = 0n;
    for (const log of receipt.data.logs) {
      if (log.transactionHash.toLowerCase() !== hash) continue;
      amount += transferValue(log, input.refundTo) ?? 0n;
    }
    if (amount === 0n) continue;
    if (big(receipt.data.blockNumber) > final.number) return { ok: false, reason: 'REFUND_NOT_FINAL' };
    refunded += amount;
    refundTxs.push(hash);
    const block = big(receipt.data.blockNumber);
    if (firstRefundBlock === null || block < firstRefundBlock) firstRefundBlock = block;
  }
  if (refunded === 0n || firstRefundBlock === null) return { ok: false, reason: 'REFUND_NOT_FOUND' };
  if (input.reportedRefundedAmount !== null && (!/^\d+$/.test(input.reportedRefundedAmount) || BigInt(input.reportedRefundedAmount) !== refunded)) {
    return { ok: false, reason: 'REFUND_AMOUNT_MISMATCH' };
  }
  const deposited = deposits.reduce((s, d) => s + d.amount, 0n);
  if (refunded > deposited) return { ok: false, reason: 'REFUND_EXCEEDS_DEPOSIT' };
  // A reported partial refund cannot discharge the remaining deposit. Any
  // legitimate fee deduction needs separate evidence before a new payment.
  if (refunded < deposited) return { ok: false, reason: 'REFUND_INCOMPLETE' };
  // A deposit at or after the refund block would not be covered by this refund.
  if (deposits.some(d => d.block >= firstRefundBlock)) return { ok: false, reason: 'DEPOSIT_AFTER_REFUND' };
  return { ok: true, deposited: deposited.toString(), refunded: refunded.toString(), refundTxs, finalizedBlock: final.number.toString() };
}
