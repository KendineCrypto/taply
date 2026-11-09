import { z } from "zod";
import { AccountIdSchema, parseStrictJson, U128Schema } from "@taply/shared";
import { createRpc, parseConfig, TESTNET_GENESIS_HASH } from "./rpc.js";
import type { Fetch } from "./rpc.js";
import { BlockSchema, CallResultSchema } from "./validation.js";
import type { NearTestnetConfig } from "./types.js";

/**
 * Pay a NEAR request with Testnet USDC: the payer converts USDC to native NEAR
 * on Ref Finance (Rhea) Testnet, then pays the request with the unchanged,
 * reviewed `pay_instant_native` path. The merchant always receives NEAR.
 *
 * Pinned route, verified on real Testnet (docs/evidence/usdc-swap-2026-11-09):
 * - exchange `ref-finance-101.testnet`, wrapped NEAR `wrap.testnet`;
 * - token `usdc.itachicara.testnet` ("USDC", 24 decimals, not publicly mintable,
 *   so its price is not trivially drained; TEST TOKEN, NO REAL VALUE);
 * - simple pool 1103 (USDC / wNEAR).
 * The swap is exact-in on Ref; an exact NEAR output is reached by sending the
 * reserve-math input plus a small slippage buffer with `min_amount_out` = the
 * wanted NEAR. If the price moves past the buffer, Ref fails the swap and the
 * token refunds the whole input (NEP-141 resolve).
 */
export const TESTNET_USDC_ROUTE = Object.freeze({
  exchange: "ref-finance-101.testnet",
  wrappedNear: "wrap.testnet",
  token: "usdc.itachicara.testnet",
  poolId: 1103,
  symbol: "USDC",
  decimals: 24,
});
export type SwapRoute = typeof TESTNET_USDC_ROUTE;

/** Ref call gas: transfer + swap + unwrap + native transfer + resolve (~35 Tgas observed). */
export const SWAP_GAS = "200000000000000";
const SMALL_GAS = "10000000000000";
export const DEFAULT_SLIPPAGE_BPS = 50;
/** Refuse quotes moving the pool by more than this share of the output reserve. */
const MAX_OUTPUT_SHARE_BPS = 500n;

export class SwapError extends Error {
  constructor(readonly code: "NETWORK_MISMATCH" | "POOL_MISMATCH" | "INVALID_AMOUNT" | "INSUFFICIENT_TOKEN" |
    "NOT_REGISTERED" | "PRICE_IMPACT_TOO_HIGH" | "RPC_UNAVAILABLE") {
    super(`taply-swap:${code}`); this.name = "SwapError";
  }
}

export interface SwapSnapshot {
  readonly route: SwapRoute;
  readonly blockHash: string;
  readonly blockHeight: string;
  readonly tokenReserve: string;
  readonly nearReserve: string;
  readonly feeBps: number;
  readonly payer: {
    readonly accountId: string;
    readonly tokenBalance: string;
    readonly tokenRegistered: boolean;
    readonly wrappedNearRegistered: boolean;
  };
  readonly tokenStorageMinYocto: string;
  readonly wrappedNearStorageMinYocto: string;
}

const PoolSchema = z.object({
  pool_kind: z.literal("SIMPLE_POOL"),
  token_account_ids: z.tuple([z.string(), z.string()]),
  amounts: z.tuple([U128Schema, U128Schema]),
  total_fee: z.number().int().min(0).max(10_000),
});
const MetadataSchema = z.object({ symbol: z.string(), decimals: z.number().int() });
const StorageBoundsSchema = z.object({ min: U128Schema });
const StorageBalanceSchema = z.object({ total: U128Schema }).nullable();

/** Reads pool, token metadata and the payer's balances at ONE final block. */
export function createSwapReader(config: NearTestnetConfig, fetcher: Fetch = (url, init) => globalThis.fetch(url, init), route: SwapRoute = TESTNET_USDC_ROUTE) {
  const rpc = createRpc(parseConfig(config), fetcher);
  const parse = <T>(schema: z.ZodType<T>, value: unknown, code: SwapError["code"] = "POOL_MISMATCH"): T => {
    const r = schema.safeParse(value);
    if (!r.success) throw new SwapError(code);
    return r.data;
  };
  return {
    async read(payerAccountId: string): Promise<SwapSnapshot> {
      if (!AccountIdSchema.safeParse(payerAccountId).success) throw new SwapError("INVALID_AMOUNT");
      try {
        const status = parse(z.object({ chain_id: z.string(), genesis_hash: z.string() }), await rpc("status", []), "NETWORK_MISMATCH");
        if (status.chain_id !== "testnet" || status.genesis_hash !== TESTNET_GENESIS_HASH) throw new SwapError("NETWORK_MISMATCH");
        const block = parse(BlockSchema, await rpc("block", { finality: "final" }), "RPC_UNAVAILABLE");
        const call = async (accountId: string, method: string, args: Record<string, unknown>) => {
          const raw = parse(CallResultSchema, await rpc("query", { request_type: "call_function", account_id: accountId, method_name: method,
            args_base64: btoa(JSON.stringify(args)), block_id: block.hash }), "RPC_UNAVAILABLE");
          if (raw.block_hash !== block.hash) throw new SwapError("RPC_UNAVAILABLE");
          return parseStrictJson(Uint8Array.from(raw.result));
        };
        const [pool, meta, balance, tokenStorage, wrapStorage, tokenBounds, wrapBounds] = await Promise.all([
          call(route.exchange, "get_pool", { pool_id: route.poolId }),
          call(route.token, "ft_metadata", {}),
          call(route.token, "ft_balance_of", { account_id: payerAccountId }),
          call(route.token, "storage_balance_of", { account_id: payerAccountId }),
          call(route.wrappedNear, "storage_balance_of", { account_id: payerAccountId }),
          call(route.token, "storage_balance_bounds", {}),
          call(route.wrappedNear, "storage_balance_bounds", {}),
        ]);
        const p = parse(PoolSchema, pool);
        const m = parse(MetadataSchema, meta);
        if (m.decimals !== route.decimals || m.symbol !== route.symbol) throw new SwapError("POOL_MISMATCH");
        const it = p.token_account_ids.indexOf(route.token), iw = p.token_account_ids.indexOf(route.wrappedNear);
        if (it < 0 || iw < 0 || it === iw) throw new SwapError("POOL_MISMATCH");
        return Object.freeze({
          route, blockHash: block.hash, blockHeight: block.height,
          tokenReserve: p.amounts[it]!, nearReserve: p.amounts[iw]!, feeBps: p.total_fee,
          payer: Object.freeze({ accountId: payerAccountId, tokenBalance: parse(U128Schema, balance),
            tokenRegistered: parse(StorageBalanceSchema, tokenStorage) !== null,
            wrappedNearRegistered: parse(StorageBalanceSchema, wrapStorage) !== null }),
          tokenStorageMinYocto: parse(StorageBoundsSchema, tokenBounds).min,
          wrappedNearStorageMinYocto: parse(StorageBoundsSchema, wrapBounds).min,
        });
      } catch (error) {
        if (error instanceof SwapError) throw error;
        throw new SwapError("RPC_UNAVAILABLE");
      }
    },
  };
}
export type SwapReader = ReturnType<typeof createSwapReader>;

function positive(value: string | bigint): bigint {
  const v = typeof value === "bigint" ? value : /^[0-9]{1,39}$/.test(value) ? BigInt(value) : -1n;
  if (v <= 0n) throw new SwapError("INVALID_AMOUNT");
  return v;
}
function bps(slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw new SwapError("INVALID_AMOUNT");
  return BigInt(slippageBps);
}
/** Ref simple-pool output for an exact input (fee in basis points). */
export function simplePoolOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  const withFee = amountIn * BigInt(10_000 - feeBps);
  return (withFee * reserveOut) / (reserveIn * 10_000n + withFee);
}

export interface SellQuote {
  /** Token amount the payer sends (reserve math + slippage buffer). */
  readonly tokenIn: string;
  /** Exact reserve-math input at the read block, before the buffer. */
  readonly tokenInAtQuote: string;
  /** The swap fails unless at least this much native NEAR arrives. */
  readonly minNearOut: string;
  /** What the pool would return for `tokenIn` at the read block. */
  readonly expectedNearOut: string;
}

/** USDC needed so that AT LEAST `nearOutYocto` native NEAR arrives. */
export function quoteTokenForExactNear(snapshot: SwapSnapshot, nearOutYocto: string, slippageBps = DEFAULT_SLIPPAGE_BPS): SellQuote {
  const want = positive(nearOutYocto);
  const rin = positive(snapshot.tokenReserve), rout = positive(snapshot.nearReserve);
  if (want * 10_000n > rout * MAX_OUTPUT_SHARE_BPS) throw new SwapError("PRICE_IMPACT_TOO_HIGH");
  const fee = BigInt(10_000 - snapshot.feeBps);
  const need = (rin * want * 10_000n) / ((rout - want) * fee) + 1n;
  const tokenIn = need + (need * bps(slippageBps) + 9_999n) / 10_000n;
  return Object.freeze({ tokenIn: tokenIn.toString(), tokenInAtQuote: need.toString(), minNearOut: want.toString(),
    expectedNearOut: simplePoolOut(tokenIn, rin, rout, snapshot.feeBps).toString() });
}

export interface BuyQuote { readonly nearIn: string; readonly expectedTokenOut: string; readonly minTokenOut: string }
/** Test USDC the payer gets for `nearInYocto` (min = expected minus slippage). */
export function quoteExactNearForToken(snapshot: SwapSnapshot, nearInYocto: string, slippageBps = DEFAULT_SLIPPAGE_BPS): BuyQuote {
  const nearIn = positive(nearInYocto);
  const rin = positive(snapshot.nearReserve), rout = positive(snapshot.tokenReserve);
  const out = simplePoolOut(nearIn, rin, rout, snapshot.feeBps);
  if (out * 10_000n > rout * MAX_OUTPUT_SHARE_BPS) throw new SwapError("PRICE_IMPACT_TOO_HIGH");
  return Object.freeze({ nearIn: nearIn.toString(), expectedTokenOut: out.toString(),
    minTokenOut: (out - (out * bps(slippageBps)) / 10_000n).toString() });
}

export interface PreparedFunctionCall {
  readonly methodName: string;
  readonly args: Record<string, unknown>;
  readonly gas: string;
  readonly depositYocto: string;
}
/** One transaction (one receiver, one or more function calls) for the payer's wallet. */
export interface PreparedSwapTransaction {
  readonly purpose: "REGISTER_TOKEN" | "BUY_TOKEN" | "SELL_TOKEN_FOR_NEAR";
  readonly receiverId: string;
  readonly actions: readonly PreparedFunctionCall[];
}

/** One-time NEP-145 registration so the payer can hold test USDC. */
export function prepareTokenRegistration(snapshot: SwapSnapshot): PreparedSwapTransaction {
  return Object.freeze({ purpose: "REGISTER_TOKEN", receiverId: snapshot.route.token, actions: [{ methodName: "storage_deposit",
    args: { account_id: snapshot.payer.accountId, registration_only: true }, gas: SMALL_GAS, depositYocto: positive(snapshot.tokenStorageMinYocto).toString() }] });
}

/** Get test USDC: wrap `quote.nearIn` NEAR and swap it on Ref, all in ONE transaction to wrap.testnet. */
export function prepareBuyToken(snapshot: SwapSnapshot, quote: BuyQuote): PreparedSwapTransaction {
  if (!snapshot.payer.tokenRegistered) throw new SwapError("NOT_REGISTERED");
  const r = snapshot.route;
  const amount = positive(quote.nearIn).toString();
  const msg = JSON.stringify({ force: 0, actions: [{ pool_id: r.poolId, token_in: r.wrappedNear, token_out: r.token, amount_in: amount, min_amount_out: positive(quote.minTokenOut).toString() }] });
  const actions: PreparedFunctionCall[] = [];
  if (!snapshot.payer.wrappedNearRegistered) actions.push({ methodName: "storage_deposit", args: { account_id: snapshot.payer.accountId, registration_only: true },
    gas: SMALL_GAS, depositYocto: positive(snapshot.wrappedNearStorageMinYocto).toString() });
  actions.push({ methodName: "near_deposit", args: {}, gas: SMALL_GAS, depositYocto: amount });
  actions.push({ methodName: "ft_transfer_call", args: { receiver_id: r.exchange, amount, msg }, gas: SWAP_GAS, depositYocto: "1" });
  return Object.freeze({ purpose: "BUY_TOKEN", receiverId: r.wrappedNear, actions });
}

/** Convert test USDC to at least `quote.minNearOut` NATIVE NEAR (Ref unwraps: skip_unwrap_near false). */
export function prepareSellTokenForNear(snapshot: SwapSnapshot, quote: SellQuote): PreparedSwapTransaction {
  const r = snapshot.route;
  const amount = positive(quote.tokenIn);
  if (amount > BigInt(snapshot.payer.tokenBalance)) throw new SwapError("INSUFFICIENT_TOKEN");
  const msg = JSON.stringify({ force: 0, actions: [{ pool_id: r.poolId, token_in: r.token, token_out: r.wrappedNear, amount_in: amount.toString(),
    min_amount_out: positive(quote.minNearOut).toString() }], skip_unwrap_near: false });
  return Object.freeze({ purpose: "SELL_TOKEN_FOR_NEAR", receiverId: r.token, actions: [{ methodName: "ft_transfer_call",
    args: { receiver_id: r.exchange, amount: amount.toString(), msg }, gas: SWAP_GAS, depositYocto: "1" }] });
}
