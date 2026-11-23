import { z } from 'zod';
import { MainnetAccountSchema, MAINNET_USDC, U128Schema, HashHexSchema, parseStrictJson } from '@taply/shared';
import { AccountSchema, CallResultSchema, HashSchema } from './validation.js';
import { mainnetTransport, type MainnetReadProfile } from './mainnet-network.js';
import type { Fetch } from './rpc.js';

/**
 * NEAR Mainnet swap policy: native NEAR, wNEAR and USDC on ONE pinned Rhea
 * (Ref v2) simple pool. Verified on chain 2026-11-23 (docs/MAINNET_SWAP.md):
 *
 * - exchange `v2.ref-finance.near` metadata version 1.9.22, code hash pinned;
 * - `wrap.near` (wNEAR, 24 decimals) code hash pinned;
 * - USDC `17208628…33a1` (6 decimals), code hash from the existing USDC pin;
 * - pool 4512, SIMPLE_POOL [USDC, wrap.near], total fee 30 bps.
 *
 * Behaviour verified from the deployed WASM strings and real Mainnet receipts
 * (no public contract source is reachable any more):
 * - an instant swap is `ft_transfer_call` on the input token to the exchange
 *   with msg `{"actions":[...]}`; the sender needs no exchange registration;
 * - output is sent with `ft_transfer`; when the receiver is NOT registered on the
 *   output token the exchange keeps it in a "lostfound" account, so this policy
 *   REQUIRES registration on the output token before a swap;
 * - when `min_amount_out` is not met the exchange panics and the input token
 *   refunds the WHOLE input (the transaction still ends in SuccessValue "0");
 * - `skip_unwrap_near` exists. This policy always sets it to `true`, so a swap
 *   delivers wNEAR, and native NEAR is a separate, visible `near_withdraw` step.
 *
 * This module never signs. It turns one allowlisted operation into one exact
 * function call after re-reading chain state at the planner's snapshot block.
 */
export const MAINNET_REF_EXCHANGE = 'v2.ref-finance.near';
export const MAINNET_REF_CODE_HASH = 'txLoEFi4RvYZ7wFNrqV61ggDdmrgHmatBkpXwtGN1FD';
export const MAINNET_WRAP = 'wrap.near';
export const MAINNET_WRAP_CODE_HASH = 'DL2f5xmZ44cQRP6vBMt94rvseH5d5KKnAGis2WkTAsh1';
export const MAINNET_SWAP_POOL = Object.freeze({ id: 4512, kind: 'SIMPLE_POOL' as const, tokens: Object.freeze([MAINNET_USDC, MAINNET_WRAP]) as readonly string[], feeBps: 30 });
export type MainnetSwapToken = typeof MAINNET_WRAP | typeof MAINNET_USDC;
export const MAINNET_SWAP_TOKENS: readonly MainnetSwapToken[] = Object.freeze([MAINNET_WRAP, MAINNET_USDC]);
export const MAINNET_SWAP_DECIMALS: Readonly<Record<MainnetSwapToken, number>> = Object.freeze({ [MAINNET_WRAP]: 24, [MAINNET_USDC]: 6 });

/** Swap limits are separate from payment caps (owner can change them in review). */
export const MAINNET_SWAP_LIMITS = Object.freeze({
  maxInput: Object.freeze({ [MAINNET_WRAP]: 25_000000000000000000000000n, [MAINNET_USDC]: 75_000000n }) as Readonly<Record<MainnetSwapToken, bigint>>,
  /** Policy floor for min_amount_out: never more than 5 % below the block's expected output. */
  maxSlippageBps: 500,
  defaultSlippageBps: 50,
  highSlippageBps: 100,
  /** Price impact above this needs an extra confirmation in the UI. */
  highImpactBps: 100,
  /** Price impact above this is refused. */
  maxImpactBps: 300,
  /** A storage registration deposit above this is refused (both tokens ask 0.00125 NEAR). */
  maxStorageDepositYocto: 10_000000000000000000000n,
});
export const MAINNET_SWAP_GAS = Object.freeze({ register: '30000000000000', wrap: '20000000000000', swap: '150000000000000', unwrap: '30000000000000' });

export type MainnetSwapOperation =
  | { kind: 'swapRegister'; swapId: string; token: MainnetSwapToken }
  | { kind: 'swapWrap'; swapId: string; amountYocto: string }
  | { kind: 'swapExact'; swapId: string; tokenIn: MainnetSwapToken; tokenOut: MainnetSwapToken; amountIn: string; minAmountOut: string }
  | { kind: 'swapUnwrap'; swapId: string; amountYocto: string };
export const MAINNET_SWAP_OPERATION_KINDS = Object.freeze(['swapRegister', 'swapWrap', 'swapExact', 'swapUnwrap'] as const);
export function isMainnetSwapOperation(op: { kind: string }): op is MainnetSwapOperation {
  return (MAINNET_SWAP_OPERATION_KINDS as readonly string[]).includes(op.kind);
}

export class MainnetSwapError extends Error {
  constructor(readonly code: 'SWAP_INVALID_AMOUNT' | 'SWAP_TOKEN_NOT_ALLOWED' | 'SWAP_SAME_TOKEN' | 'SWAP_CAP_EXCEEDED' | 'SWAP_POOL_MISMATCH' |
    'SWAP_CODE_PIN_MISMATCH' | 'SWAP_NOT_REGISTERED' | 'SWAP_ALREADY_REGISTERED' | 'SWAP_INSUFFICIENT_TOKEN' | 'SWAP_MIN_OUT_TOO_LOW' |
    'SWAP_QUOTE_MOVED' | 'SWAP_PRICE_IMPACT_TOO_HIGH' | 'SWAP_NO_LIQUIDITY' | 'SWAP_STORAGE_OUT_OF_BOUNDS' | 'SWAP_MATH_MISMATCH' |
    'SWAP_EVIDENCE_MISMATCH' | 'TOKEN_CODE_PIN_REQUIRED') { super(code); this.name = 'MainnetSwapError'; }
}

const UINT = /^(0|[1-9][0-9]{0,38})$/;
function positive(value: string): bigint {
  if (typeof value !== 'string' || !UINT.test(value) || BigInt(value) <= 0n) throw new MainnetSwapError('SWAP_INVALID_AMOUNT');
  return BigInt(value);
}
function swapToken(value: string): MainnetSwapToken {
  if (!(MAINNET_SWAP_TOKENS as readonly string[]).includes(value)) throw new MainnetSwapError('SWAP_TOKEN_NOT_ALLOWED');
  return value as MainnetSwapToken;
}

/** Ref simple-pool exact-input output (integer math, fee in basis points of 10 000). */
export function mainnetSimplePoolOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n || !Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) throw new MainnetSwapError('SWAP_NO_LIQUIDITY');
  const withFee = amountIn * BigInt(10_000 - feeBps);
  return (withFee * reserveOut) / (reserveIn * 10_000n + withFee);
}
/** Price impact (bps) from the pool curve alone, excluding the pool fee. Rounded up. */
export function mainnetPriceImpactBps(amountIn: bigint, reserveIn: bigint): number {
  // spot output = amountIn * rOut / rIn; curve output (no fee) = amountIn * rOut / (rIn + amountIn)
  // impact = 1 - curve/spot = amountIn / (rIn + amountIn)
  const bps = (amountIn * 10_000n + (reserveIn + amountIn) - 1n) / (reserveIn + amountIn);
  return Number(bps > 10_000n ? 10_000n : bps);
}
export function mainnetMinAmountOut(expectedOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAINNET_SWAP_LIMITS.maxSlippageBps) throw new MainnetSwapError('SWAP_INVALID_AMOUNT');
  const min = (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;
  if (min <= 0n) throw new MainnetSwapError('SWAP_MIN_OUT_TOO_LOW');
  return min;
}

const Pool = z.object({ pool_kind: z.string(), token_account_ids: z.array(z.string()).length(2), amounts: z.array(U128Schema).length(2),
  total_fee: z.number().int().min(0).max(10_000) });
const Storage = z.object({ total: U128Schema }).passthrough().nullable();
const Bounds = z.object({ min: U128Schema }).passthrough();
const Meta = z.object({ symbol: z.string(), decimals: z.number().int() }).passthrough();

export interface MainnetSwapChainView {
  account(id: string, codeHash?: string): Promise<unknown>;
  view(id: string, method: string, args: object): Promise<unknown>;
}
export interface MainnetSwapPoolState { readonly reserves: Readonly<Record<MainnetSwapToken, string>>; readonly feeBps: number }

/** Pool 4512 at the caller's block, with every pin checked. */
export async function readMainnetSwapPool(chain: MainnetSwapChainView, usdcCodeHash: string | undefined): Promise<MainnetSwapPoolState> {
  if (!usdcCodeHash) throw new MainnetSwapError('TOKEN_CODE_PIN_REQUIRED');
  try {
    await Promise.all([chain.account(MAINNET_REF_EXCHANGE, MAINNET_REF_CODE_HASH), chain.account(MAINNET_WRAP, MAINNET_WRAP_CODE_HASH), chain.account(MAINNET_USDC, usdcCodeHash)]);
  } catch (e) { if (e instanceof Error && e.message === 'EVIDENCE_MISMATCH') throw new MainnetSwapError('SWAP_CODE_PIN_MISMATCH'); throw e; }
  const p = Pool.safeParse(await chain.view(MAINNET_REF_EXCHANGE, 'get_pool', { pool_id: MAINNET_SWAP_POOL.id }));
  if (!p.success || p.data.pool_kind !== MAINNET_SWAP_POOL.kind || p.data.total_fee !== MAINNET_SWAP_POOL.feeBps ||
    p.data.token_account_ids[0] !== MAINNET_SWAP_POOL.tokens[0] || p.data.token_account_ids[1] !== MAINNET_SWAP_POOL.tokens[1]) throw new MainnetSwapError('SWAP_POOL_MISMATCH');
  const reserves = { [MAINNET_USDC]: p.data.amounts[0]!, [MAINNET_WRAP]: p.data.amounts[1]! } as Record<MainnetSwapToken, string>;
  if (BigInt(reserves[MAINNET_USDC]) === 0n || BigInt(reserves[MAINNET_WRAP]) === 0n) throw new MainnetSwapError('SWAP_NO_LIQUIDITY');
  return Object.freeze({ reserves: Object.freeze(reserves), feeBps: p.data.total_fee });
}

export interface MainnetSwapQuoteMath {
  readonly tokenIn: MainnetSwapToken; readonly tokenOut: MainnetSwapToken; readonly amountIn: string;
  readonly expectedOut: string; readonly priceImpactBps: number; readonly poolFeeIn: string; readonly feeBps: number;
}
/** Exact-input quote at a block; `getReturn` (the exchange's own view) must agree exactly. */
export async function quoteMainnetSwap(chain: MainnetSwapChainView, pool: MainnetSwapPoolState, tokenIn: string, tokenOut: string, amountIn: string): Promise<MainnetSwapQuoteMath> {
  const tin = swapToken(tokenIn), tout = swapToken(tokenOut);
  if (tin === tout) throw new MainnetSwapError('SWAP_SAME_TOKEN');
  const amount = positive(amountIn);
  if (amount > MAINNET_SWAP_LIMITS.maxInput[tin]) throw new MainnetSwapError('SWAP_CAP_EXCEEDED');
  const rin = BigInt(pool.reserves[tin]), rout = BigInt(pool.reserves[tout]);
  const expected = mainnetSimplePoolOut(amount, rin, rout, pool.feeBps);
  if (expected <= 0n) throw new MainnetSwapError('SWAP_NO_LIQUIDITY');
  const onChain = U128Schema.safeParse(await chain.view(MAINNET_REF_EXCHANGE, 'get_return', { pool_id: MAINNET_SWAP_POOL.id, token_in: tin, amount_in: amount.toString(), token_out: tout }));
  if (!onChain.success || BigInt(onChain.data) !== expected) throw new MainnetSwapError('SWAP_MATH_MISMATCH');
  return Object.freeze({ tokenIn: tin, tokenOut: tout, amountIn: amount.toString(), expectedOut: expected.toString(),
    priceImpactBps: mainnetPriceImpactBps(amount, rin), poolFeeIn: ((amount * BigInt(pool.feeBps) + 9_999n) / 10_000n).toString(), feeBps: pool.feeBps });
}

export function mainnetSwapMsg(tokenIn: MainnetSwapToken, tokenOut: MainnetSwapToken, amountIn: string, minAmountOut: string): string {
  return JSON.stringify({ actions: [{ pool_id: MAINNET_SWAP_POOL.id, token_in: tokenIn, token_out: tokenOut, amount_in: amountIn, min_amount_out: minAmountOut }], skip_unwrap_near: true });
}

export interface MainnetSwapCall { receiverId: string; methodName: string; args: Record<string, unknown>; gas: string; depositYocto: string }

/**
 * Planner policy: ONE allowlisted call per operation, re-derived at the snapshot
 * block. Caller-supplied receivers, methods, msg JSON or pools are not inputs.
 */
export async function planMainnetSwapOperation(op: MainnetSwapOperation, accountId: string, chain: MainnetSwapChainView, usdcCodeHash: string | undefined): Promise<MainnetSwapCall> {
  MainnetAccountSchema.parse(accountId); HashHexSchema.parse(op.swapId);
  const pool = await readMainnetSwapPool(chain, usdcCodeHash);
  const registered = async (token: MainnetSwapToken, who: string) => {
    const s = Storage.safeParse(await chain.view(token, 'storage_balance_of', { account_id: who }));
    if (!s.success) throw new MainnetSwapError('SWAP_EVIDENCE_MISMATCH');
    return s.data !== null;
  };
  const balance = async (token: MainnetSwapToken) => {
    const b = U128Schema.safeParse(await chain.view(token, 'ft_balance_of', { account_id: accountId }));
    if (!b.success) throw new MainnetSwapError('SWAP_EVIDENCE_MISMATCH');
    return BigInt(b.data);
  };
  if (op.kind === 'swapRegister') {
    const token = swapToken(op.token);
    if (await registered(token, accountId)) throw new MainnetSwapError('SWAP_ALREADY_REGISTERED');
    const bounds = Bounds.safeParse(await chain.view(token, 'storage_balance_bounds', {}));
    if (!bounds.success || BigInt(bounds.data.min) <= 0n || BigInt(bounds.data.min) > MAINNET_SWAP_LIMITS.maxStorageDepositYocto) throw new MainnetSwapError('SWAP_STORAGE_OUT_OF_BOUNDS');
    return { receiverId: token, methodName: 'storage_deposit', args: { account_id: accountId, registration_only: true }, gas: MAINNET_SWAP_GAS.register, depositYocto: bounds.data.min };
  }
  if (op.kind === 'swapWrap') {
    const amount = positive(op.amountYocto);
    if (amount > MAINNET_SWAP_LIMITS.maxInput[MAINNET_WRAP]) throw new MainnetSwapError('SWAP_CAP_EXCEEDED');
    // wrap.near would silently take its storage fee out of an unregistered deposit; exact amounts only.
    if (!await registered(MAINNET_WRAP, accountId)) throw new MainnetSwapError('SWAP_NOT_REGISTERED');
    return { receiverId: MAINNET_WRAP, methodName: 'near_deposit', args: {}, gas: MAINNET_SWAP_GAS.wrap, depositYocto: amount.toString() };
  }
  if (op.kind === 'swapUnwrap') {
    const amount = positive(op.amountYocto);
    if (amount > await balance(MAINNET_WRAP)) throw new MainnetSwapError('SWAP_INSUFFICIENT_TOKEN');
    return { receiverId: MAINNET_WRAP, methodName: 'near_withdraw', args: { amount: amount.toString() }, gas: MAINNET_SWAP_GAS.unwrap, depositYocto: '1' };
  }
  if (op.kind !== 'swapExact') throw new MainnetSwapError('SWAP_TOKEN_NOT_ALLOWED');
  const q = await quoteMainnetSwap(chain, pool, op.tokenIn, op.tokenOut, op.amountIn);
  const min = positive(op.minAmountOut), expected = BigInt(q.expectedOut);
  if (q.priceImpactBps > MAINNET_SWAP_LIMITS.maxImpactBps) throw new MainnetSwapError('SWAP_PRICE_IMPACT_TOO_HIGH');
  // min_amount_out is never 0 and never further than the policy floor below this block's output.
  if (min < (expected * BigInt(10_000 - MAINNET_SWAP_LIMITS.maxSlippageBps)) / 10_000n) throw new MainnetSwapError('SWAP_MIN_OUT_TOO_LOW');
  // A minimum above the block's output would only fail on chain: the quote is stale.
  if (min > expected) throw new MainnetSwapError('SWAP_QUOTE_MOVED');
  if (BigInt(q.amountIn) > await balance(q.tokenIn)) throw new MainnetSwapError('SWAP_INSUFFICIENT_TOKEN');
  const [inReg, outReg, exchangeReg] = await Promise.all([registered(q.tokenIn, accountId), registered(q.tokenOut, accountId), registered(q.tokenIn, MAINNET_REF_EXCHANGE)]);
  // Output without a registration would sit in the exchange's lostfound account.
  if (!inReg || !outReg || !exchangeReg) throw new MainnetSwapError('SWAP_NOT_REGISTERED');
  return { receiverId: q.tokenIn, methodName: 'ft_transfer_call',
    args: { receiver_id: MAINNET_REF_EXCHANGE, amount: q.amountIn, msg: mainnetSwapMsg(q.tokenIn, q.tokenOut, q.amountIn, min.toString()) },
    gas: MAINNET_SWAP_GAS.swap, depositYocto: '1' };
}

export interface MainnetSwapAccountState {
  readonly nearYocto: string; readonly balances: Readonly<Record<MainnetSwapToken, string>>;
  readonly registered: Readonly<Record<MainnetSwapToken, boolean>>; readonly storageMinYocto: Readonly<Record<MainnetSwapToken, string>>;
  readonly storageUsageBytes: string;
  /** Network fee inputs at the read block, so the UI can reserve gas exactly like the signing budget. */
  readonly gasPriceYocto: string; readonly storageByteCostYocto: string;
}
export interface MainnetSwapRead {
  readonly blockHash: string; readonly blockHeight: string; readonly blockTimestampNs: string;
  readonly pool: MainnetSwapPoolState; readonly account: MainnetSwapAccountState | null;
}

/** Read-only quote source for the UI: the same pins, pool and math as the planner, at one final block. */
export function createMainnetSwapReader(profile: MainnetReadProfile, usdcCodeHash: string | undefined, fetcher: Fetch = (u, i) => globalThis.fetch(u, i)) {
  const { rpc, checkNetwork, finalBlock } = mainnetTransport(profile, fetcher);
  const at = (blockHash: string, blockHeight: string): MainnetSwapChainView => ({
    async account(id, codeHash) {
      const a = AccountSchema.parse(await rpc('query', { request_type: 'view_account', account_id: id, block_id: blockHash }));
      if (a.block_hash !== blockHash || a.block_height !== blockHeight || (codeHash !== undefined && a.code_hash !== HashSchema.parse(codeHash))) throw Error('EVIDENCE_MISMATCH');
      return a;
    },
    async view(id, method, args) {
      const r = CallResultSchema.parse(await rpc('query', { request_type: 'call_function', account_id: id, block_id: blockHash, method_name: method,
        args_base64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args)))) }));
      if (r.block_hash !== blockHash || r.block_height !== blockHeight) throw Error('EVIDENCE_MISMATCH');
      return parseStrictJson(new Uint8Array(r.result));
    },
  });
  return Object.freeze({
    async read(accountId: string | null): Promise<MainnetSwapRead & { chain: MainnetSwapChainView }> {
      if (accountId !== null) MainnetAccountSchema.parse(accountId);
      await checkNetwork();
      const block = await finalBlock();
      const chain = at(block.hash, block.height);
      const pool = await readMainnetSwapPool(chain, usdcCodeHash);
      // Token metadata is re-checked so a decimals change can never be shown with the pinned scale.
      const [wm, um] = await Promise.all([chain.view(MAINNET_WRAP, 'ft_metadata', {}), chain.view(MAINNET_USDC, 'ft_metadata', {})]);
      const w = Meta.safeParse(wm), u = Meta.safeParse(um);
      if (!w.success || !u.success || w.data.decimals !== 24 || u.data.decimals !== 6) throw new MainnetSwapError('SWAP_POOL_MISMATCH');
      let account: MainnetSwapAccountState | null = null;
      if (accountId !== null) {
        const a = (await chain.account(accountId)) as z.output<typeof AccountSchema>;
        const [rawProtocol, rawGas] = await Promise.all([rpc('EXPERIMENTAL_protocol_config', { block_id: block.hash }), rpc('gas_price', [block.hash])]);
        const protocol = z.object({ runtime_config: z.object({ storage_amount_per_byte: U128Schema }) }).parse(rawProtocol);
        const gas = z.object({ gas_price: U128Schema }).parse(rawGas);
        const reads = await Promise.all([
          chain.view(MAINNET_WRAP, 'ft_balance_of', { account_id: accountId }), chain.view(MAINNET_USDC, 'ft_balance_of', { account_id: accountId }),
          chain.view(MAINNET_WRAP, 'storage_balance_of', { account_id: accountId }), chain.view(MAINNET_USDC, 'storage_balance_of', { account_id: accountId }),
          chain.view(MAINNET_WRAP, 'storage_balance_bounds', {}), chain.view(MAINNET_USDC, 'storage_balance_bounds', {}),
        ]);
        account = Object.freeze({
          nearYocto: a.amount, storageUsageBytes: a.storage_usage,
          gasPriceYocto: gas.gas_price, storageByteCostYocto: protocol.runtime_config.storage_amount_per_byte,
          balances: Object.freeze({ [MAINNET_WRAP]: U128Schema.parse(reads[0]), [MAINNET_USDC]: U128Schema.parse(reads[1]) }) as Record<MainnetSwapToken, string>,
          registered: Object.freeze({ [MAINNET_WRAP]: Storage.parse(reads[2]) !== null, [MAINNET_USDC]: Storage.parse(reads[3]) !== null }) as Record<MainnetSwapToken, boolean>,
          storageMinYocto: Object.freeze({ [MAINNET_WRAP]: Bounds.parse(reads[4]).min, [MAINNET_USDC]: Bounds.parse(reads[5]).min }) as Record<MainnetSwapToken, string>,
        });
      }
      return { blockHash: block.hash, blockHeight: block.height, blockTimestampNs: block.timestampNs, pool, account, chain };
    },
  });
}

// ---------------------------------------------------------------------------
// FINAL outcome verification (chain proof, separate from the wallet's claim)
// ---------------------------------------------------------------------------

const Status = z.union([z.strictObject({ SuccessValue: z.string() }), z.strictObject({ SuccessReceiptId: HashSchema }), z.strictObject({ Failure: z.unknown() })]);
const Outcome = z.object({ id: HashSchema, block_hash: HashSchema, outcome: z.object({ executor_id: z.string(), status: Status, logs: z.array(z.string().max(16384)).max(1024), receipt_ids: z.array(HashSchema).max(256) }) });
const ReceiptAction = z.union([
  z.object({ Transfer: z.object({ deposit: U128Schema }) }),
  z.object({ FunctionCall: z.object({ method_name: z.string(), args: z.string(), deposit: U128Schema, gas: z.union([z.number(), z.string()]) }) }),
  z.unknown(),
]);
const Receipt = z.object({ receipt_id: HashSchema, predecessor_id: z.string(), receiver_id: z.string(),
  receipt: z.union([z.object({ Action: z.object({ actions: z.array(ReceiptAction).max(64) }).passthrough() }).passthrough(), z.unknown()]) });
const TxStatus = z.object({ final_execution_status: z.string(), status: Status,
  transaction: z.object({ hash: HashSchema, signer_id: z.string(), receiver_id: z.string(), actions: z.array(z.unknown()).length(1) }),
  transaction_outcome: Outcome, receipts_outcome: z.array(Outcome).max(256), receipts: z.array(Receipt).max(512).optional() });

export type MainnetSwapStepProof =
  | { kind: 'SWAPPED'; transactionHash: string; amountIn: string; amountOut: string; tokenIn: string; tokenOut: string; blockHash: string }
  | { kind: 'REFUNDED'; transactionHash: string; refunded: string; tokenIn: string }
  /** Input was used but the output transfer to the account is not proven (e.g. held in the exchange's lostfound). */
  | { kind: 'OUTPUT_NOT_DELIVERED'; transactionHash: string; amountIn: string; lostfound: boolean }
  | { kind: 'WRAPPED' | 'UNWRAPPED' | 'REGISTERED'; transactionHash: string; amount: string }
  | { kind: 'FAILED'; transactionHash: string }
  | { kind: 'NOT_VERIFIED'; reason: 'MISMATCH' | 'UNAVAILABLE' | 'NOT_FINAL' };

const ok = (s: z.infer<typeof Status>) => 'SuccessValue' in s || 'SuccessReceiptId' in s;
function decodeValue(s: z.infer<typeof Status>): string | null {
  if (!('SuccessValue' in s)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(s.SuccessValue), c => c.charCodeAt(0))); } catch { return null; }
}
function b64json(value: string): unknown { return parseStrictJson(Uint8Array.from(atob(value), c => c.charCodeAt(0))); }
/** NEP-141 transfer log from `token` (EVENT_JSON) or wrap.near's plain text format, to `to` from `from`. */
export function mainnetTokenTransferAmount(logs: readonly string[], from: string, to: string): bigint {
  let total = 0n;
  for (const log of logs) {
    if (log.startsWith('EVENT_JSON:')) {
      try {
        const e = JSON.parse(log.slice(11)) as { standard?: unknown; event?: unknown; data?: unknown };
        if (e.standard !== 'nep141' || e.event !== 'ft_transfer' || !Array.isArray(e.data)) continue;
        for (const d of e.data as Array<Record<string, unknown>>) {
          if (d['old_owner_id'] === from && d['new_owner_id'] === to && typeof d['amount'] === 'string' && UINT.test(d['amount'])) total += BigInt(d['amount']);
        }
      } catch { /* not an event */ }
      continue;
    }
    const m = /^Transfer ([0-9]{1,39}) from ([a-z0-9._-]{2,64}) to ([a-z0-9._-]{2,64})$/.exec(log);
    if (m && m[2] === from && m[3] === to) total += BigInt(m[1]!);
  }
  return total;
}

/**
 * Proves what ONE swap step did, from the FINAL receipt tree (not from the wallet,
 * the provider or the transaction's top-level status alone).
 */
export async function verifyMainnetSwapStep(profile: MainnetReadProfile, input: { transactionHash: string; accountId: string; operation: MainnetSwapOperation },
  fetcher: Fetch = (u, i) => globalThis.fetch(u, i)): Promise<MainnetSwapStepProof> {
  const { transactionHash: hash, accountId, operation: op } = input;
  if (!HashSchema.safeParse(hash).success || !MainnetAccountSchema.safeParse(accountId).success) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
  let raw: unknown;
  try {
    const { rpc, checkNetwork } = mainnetTransport(profile, fetcher);
    await checkNetwork();
    raw = await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: accountId, wait_until: 'FINAL' });
  } catch { return { kind: 'NOT_VERIFIED', reason: 'UNAVAILABLE' }; }
  const parsed = TxStatus.safeParse(raw);
  if (!parsed.success) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
  const t = parsed.data;
  if (t.final_execution_status !== 'FINAL') return { kind: 'NOT_VERIFIED', reason: 'NOT_FINAL' };
  if (t.transaction.hash !== hash || t.transaction.signer_id !== accountId) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
  const fc = z.object({ FunctionCall: z.object({ method_name: z.string(), args: z.string(), deposit: U128Schema }) }).safeParse(t.transaction.actions[0]);
  if (!fc.success) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
  let args: Record<string, unknown>;
  try { args = b64json(fc.data.FunctionCall.args) as Record<string, unknown>; } catch { return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' }; }
  const outcomes = t.receipts_outcome;
  const receipts = t.receipts ?? [];
  if ('Failure' in t.status) return { kind: 'FAILED', transactionHash: hash };
  const first = outcomes.find(o => o.outcome.executor_id === t.transaction.receiver_id);
  if (op.kind === 'swapRegister') {
    if (t.transaction.receiver_id !== op.token || fc.data.FunctionCall.method_name !== 'storage_deposit' || args['account_id'] !== accountId || !first || !ok(first.outcome.status)) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
    return { kind: 'REGISTERED', transactionHash: hash, amount: fc.data.FunctionCall.deposit };
  }
  if (op.kind === 'swapWrap') {
    if (t.transaction.receiver_id !== MAINNET_WRAP || fc.data.FunctionCall.method_name !== 'near_deposit' || fc.data.FunctionCall.deposit !== op.amountYocto || !first || !ok(first.outcome.status)) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
    if (!first.outcome.logs.includes(`Deposit ${op.amountYocto} NEAR to ${accountId}`)) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
    return { kind: 'WRAPPED', transactionHash: hash, amount: op.amountYocto };
  }
  if (op.kind === 'swapUnwrap') {
    if (t.transaction.receiver_id !== MAINNET_WRAP || fc.data.FunctionCall.method_name !== 'near_withdraw' || args['amount'] !== op.amountYocto || !first || !ok(first.outcome.status)) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
    // Native NEAR arrives as a Transfer receipt from wrap.near to the account, executed successfully.
    const paid = receipts.find(r => r.predecessor_id === MAINNET_WRAP && r.receiver_id === accountId &&
      z.object({ Action: z.object({ actions: z.array(z.object({ Transfer: z.object({ deposit: z.literal(op.amountYocto) }) })).length(1) }).passthrough() }).passthrough().safeParse(r.receipt).success);
    const paidOutcome = paid && outcomes.find(o => o.id === paid.receipt_id);
    if (!paidOutcome || !ok(paidOutcome.outcome.status)) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
    return { kind: 'UNWRAPPED', transactionHash: hash, amount: op.amountYocto };
  }
  // swapExact
  const expectedMsg = mainnetSwapMsg(op.tokenIn, op.tokenOut, op.amountIn, op.minAmountOut);
  if (t.transaction.receiver_id !== op.tokenIn || fc.data.FunctionCall.method_name !== 'ft_transfer_call' || args['receiver_id'] !== MAINNET_REF_EXCHANGE ||
    args['amount'] !== op.amountIn || args['msg'] !== expectedMsg) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
  // ft_transfer_call returns the USED amount (after ft_resolve_transfer) as a JSON string.
  const value = decodeValue(t.status);
  let used: bigint;
  try { const v = value === null ? null : JSON.parse(value); if (typeof v !== 'string' || !UINT.test(v)) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' }; used = BigInt(v); }
  catch { return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' }; }
  if (used === 0n) return { kind: 'REFUNDED', transactionHash: hash, refunded: op.amountIn, tokenIn: op.tokenIn };
  if (used !== BigInt(op.amountIn)) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
  const exchangeLogs = outcomes.filter(o => o.outcome.executor_id === MAINNET_REF_EXCHANGE).flatMap(o => o.outcome.logs);
  const lostfound = exchangeLogs.some(l => /lostfound/i.test(l));
  const delivered = outcomes.filter(o => o.outcome.executor_id === op.tokenOut && ok(o.outcome.status))
    .reduce((sum, o) => sum + mainnetTokenTransferAmount(o.outcome.logs, MAINNET_REF_EXCHANGE, accountId), 0n);
  const swapped = exchangeLogs.map(l => new RegExp(`^Swapped ${op.amountIn} ${op.tokenIn.replace(/\./g, '\\.')} for ([0-9]{1,39}) ${op.tokenOut.replace(/\./g, '\\.')}$`).exec(l)).find(Boolean);
  if (delivered === 0n || lostfound) return { kind: 'OUTPUT_NOT_DELIVERED', transactionHash: hash, amountIn: op.amountIn, lostfound };
  if (!swapped || BigInt(swapped[1]!) !== delivered || delivered < BigInt(op.minAmountOut)) return { kind: 'NOT_VERIFIED', reason: 'MISMATCH' };
  return { kind: 'SWAPPED', transactionHash: hash, amountIn: op.amountIn, amountOut: delivered.toString(), tokenIn: op.tokenIn, tokenOut: op.tokenOut, blockHash: t.transaction_outcome.block_hash };
}
