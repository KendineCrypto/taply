import { z } from 'zod';
import { MAINNET_USDC } from '@taply/shared';
import {
  MAINNET_SWAP_GAS, MAINNET_SWAP_LIMITS, MAINNET_WRAP, mainnetMinAmountOut,
  type MainnetSwapAccountState, type MainnetSwapOperation, type MainnetSwapToken,
} from '@taply/near-client';
import { InvalidAmountError, toBaseUnits } from '@/lib/format/amount';

/**
 * Swap model (pure). Assets, exact amount parsing, the Max that keeps native NEAR
 * for gas and storage, and the step plan for one swap job.
 *
 * Amounts are base-unit strings / bigint only. No float anywhere.
 */
export type SwapAssetId = 'near' | 'wnear' | 'usdc';
export interface SwapAsset {
  readonly id: SwapAssetId;
  readonly symbol: 'NEAR' | 'wNEAR' | 'USDC';
  readonly name: string;
  readonly decimals: 24 | 6;
  /** null = native NEAR (no token contract). */
  readonly contract: string | null;
  /** The pool token this asset trades as. */
  readonly token: MainnetSwapToken;
  readonly network: 'NEAR';
}
export const SWAP_ASSETS: Readonly<Record<SwapAssetId, SwapAsset>> = Object.freeze({
  near: { id: 'near', symbol: 'NEAR', name: 'NEAR', decimals: 24, contract: null, token: MAINNET_WRAP, network: 'NEAR' },
  wnear: { id: 'wnear', symbol: 'wNEAR', name: 'Wrapped NEAR', decimals: 24, contract: MAINNET_WRAP, token: MAINNET_WRAP, network: 'NEAR' },
  usdc: { id: 'usdc', symbol: 'USDC', name: 'USD Coin', decimals: 6, contract: MAINNET_USDC, token: MAINNET_USDC, network: 'NEAR' },
});
export const SWAP_ASSET_LIST: readonly SwapAsset[] = Object.freeze([SWAP_ASSETS.near, SWAP_ASSETS.usdc, SWAP_ASSETS.wnear]);
export const isSwapAssetId = (v: unknown): v is SwapAssetId => v === 'near' || v === 'wnear' || v === 'usdc';

/** Verified list only; matches name, symbol or exact contract. Metadata is never rendered as HTML. */
export function searchSwapAssets(query: string): SwapAsset[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...SWAP_ASSET_LIST];
  return SWAP_ASSET_LIST.filter(a => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || (a.contract !== null && a.contract.toLowerCase() === q) || (a.contract !== null && q.length >= 6 && a.contract.toLowerCase().startsWith(q)));
}

export type AmountInput =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ok'; readonly baseUnits: bigint }
  | { readonly kind: 'error'; readonly reason: 'invalid' | 'precision' | 'zero' | 'negative' | 'too_large' };

/**
 * What a person types or pastes ("0,5", "0.5", " 12 "), in either locale. A value with
 * both separators ("1.234,5") is ambiguous and refused rather than guessed.
 */
export function parseSwapAmount(text: string, asset: SwapAsset): AmountInput {
  const t = text.replace(/[\s  ]/g, '');
  if (t === '') return { kind: 'empty' };
  if (t.startsWith('-')) return { kind: 'error', reason: 'negative' };
  if (t.includes('.') && t.includes(',')) return { kind: 'error', reason: 'invalid' };
  if ((t.match(/[.,]/g) ?? []).length > 1) return { kind: 'error', reason: 'invalid' };
  if (!/^[0-9]*[.,]?[0-9]*$/.test(t) || t === '.' || t === ',') return { kind: 'error', reason: 'invalid' };
  const fraction = t.split(/[.,]/)[1] ?? '';
  if (fraction.length > asset.decimals) return { kind: 'error', reason: 'precision' };
  const whole = (t.split(/[.,]/)[0] ?? '').replace(/^0+(?=\d)/, '');
  if (whole.length > 12) return { kind: 'error', reason: 'too_large' };
  let units: string;
  try { units = toBaseUnits((whole === '' ? '0' : whole) + (fraction ? `.${fraction}` : ''), asset.decimals); }
  catch (e) { if (e instanceof InvalidAmountError) return { kind: 'error', reason: 'invalid' }; throw e; }
  const v = BigInt(units);
  if (v === 0n) return { kind: 'error', reason: 'zero' };
  return { kind: 'ok', baseUnits: v };
}

/** Base units -> plain input text (no grouping), in the person's decimal separator. */
export function amountToInput(baseUnits: bigint, asset: SwapAsset, locale: 'en' | 'tr'): string {
  const s = baseUnits.toString().padStart(asset.decimals + 1, '0');
  const whole = s.slice(0, s.length - asset.decimals);
  const frac = s.slice(s.length - asset.decimals).replace(/0+$/, '');
  return frac ? `${whole}${locale === 'tr' ? ',' : '.'}${frac}` : whole;
}

export type SwapStep =
  | { readonly kind: 'register'; readonly token: MainnetSwapToken }
  | { readonly kind: 'wrap'; readonly amount: string }
  | { readonly kind: 'swap'; readonly tokenIn: MainnetSwapToken; readonly tokenOut: MainnetSwapToken; readonly amountIn: string; readonly minOut: string }
  /** amount 'FROM_SWAP' = exactly the wNEAR the verified swap delivered. */
  | { readonly kind: 'unwrap'; readonly amount: string | 'FROM_SWAP' };

export interface SwapPlanInput {
  readonly from: SwapAsset; readonly to: SwapAsset; readonly amountIn: bigint;
  /** Expected output from a fresh quote (swap pairs) or amountIn for wrap/unwrap. */
  readonly expectedOut: bigint; readonly slippageBps: number;
  readonly account: MainnetSwapAccountState;
}
export interface SwapPlan {
  readonly steps: readonly SwapStep[];
  readonly minOut: bigint;
  /** Refundable token storage deposits (not a fee). */
  readonly storageDepositYocto: bigint;
  /** Upper bound of the network fee: prepaid gas of every step at the read gas price. Unused gas is refunded. */
  readonly maxNetworkFeeYocto: bigint;
  /** Native NEAR that leaves the account in total (wrap + deposits + max gas), for the balance check. */
  readonly nativeNeedYocto: bigint;
}
export const isPoolSwap = (from: SwapAsset, to: SwapAsset) => from.token !== to.token;
export const sameAsset = (from: SwapAsset, to: SwapAsset) => from.id === to.id;

/** Every step the wallet will sign, in order. Registrations only when the chain says they are missing. */
export function planSwap(input: SwapPlanInput): SwapPlan {
  const { from, to, amountIn, account } = input;
  if (sameAsset(from, to)) throw new Error('SAME_ASSET');
  if (amountIn <= 0n) throw new Error('INVALID_AMOUNT');
  const steps: SwapStep[] = [];
  const reg = (token: MainnetSwapToken) => { if (!account.registered[token] && !steps.some(s => s.kind === 'register' && s.token === token)) steps.push({ kind: 'register', token }); };
  let minOut = amountIn;
  if (!isPoolSwap(from, to)) {
    // NEAR <-> wNEAR is 1:1 on wrap.near.
    if (from.id === 'near') { reg(MAINNET_WRAP); steps.push({ kind: 'wrap', amount: amountIn.toString() }); }
    else steps.push({ kind: 'unwrap', amount: amountIn.toString() });
  } else {
    minOut = mainnetMinAmountOut(input.expectedOut, input.slippageBps);
    reg(from.token); reg(to.token);
    if (from.id === 'near') steps.push({ kind: 'wrap', amount: amountIn.toString() });
    steps.push({ kind: 'swap', tokenIn: from.token, tokenOut: to.token, amountIn: amountIn.toString(), minOut: minOut.toString() });
    if (to.id === 'near') steps.push({ kind: 'unwrap', amount: 'FROM_SWAP' });
  }
  const storageDepositYocto = steps.reduce((sum, s) => s.kind === 'register' ? sum + BigInt(account.storageMinYocto[s.token]) : sum, 0n);
  const gasOf = (s: SwapStep) => BigInt(s.kind === 'register' ? MAINNET_SWAP_GAS.register : s.kind === 'wrap' ? MAINNET_SWAP_GAS.wrap : s.kind === 'swap' ? MAINNET_SWAP_GAS.swap : MAINNET_SWAP_GAS.unwrap);
  const maxNetworkFeeYocto = steps.reduce((sum, s) => sum + gasOf(s) * BigInt(account.gasPriceYocto), 0n);
  const wrapped = steps.reduce((sum, s) => s.kind === 'wrap' ? sum + BigInt(s.amount) : sum, 0n);
  const yoctoDeposits = BigInt(steps.filter(s => s.kind === 'swap' || s.kind === 'unwrap').length);
  return { steps, minOut, storageDepositYocto, maxNetworkFeeYocto, nativeNeedYocto: wrapped + storageDepositYocto + maxNetworkFeeYocto + yoctoDeposits };
}

/**
 * Native NEAR the account must keep after the whole swap: its own storage plus the
 * signing budget's gas reserve (2 x 300 Tgas at the read gas price), exactly like the
 * wallet's spending check, so no step can strand the account without gas.
 */
export function nativeReserveYocto(account: MainnetSwapAccountState): bigint {
  return BigInt(account.storageUsageBytes) * BigInt(account.storageByteCostYocto) + 300_000_000_000_000n * BigInt(account.gasPriceYocto) * 2n;
}
export function spendableNativeYocto(account: MainnetSwapAccountState): bigint {
  const v = BigInt(account.nearYocto) - nativeReserveYocto(account);
  return v > 0n ? v : 0n;
}
export function balanceOf(asset: SwapAsset, account: MainnetSwapAccountState): bigint {
  return asset.id === 'near' ? BigInt(account.nearYocto) : BigInt(account.balances[asset.token]);
}

/** Largest input the plan can afford: tokens = full balance; native NEAR = spendable minus deposits and max gas. */
export function maxSwapInput(from: SwapAsset, to: SwapAsset, account: MainnetSwapAccountState): bigint {
  const cap = MAINNET_SWAP_LIMITS.maxInput[from.token];
  if (from.id !== 'near') { const b = balanceOf(from, account); return b > cap ? cap : b; }
  if (sameAsset(from, to)) return 0n;
  const probe = planSwap({ from, to, amountIn: 1n, expectedOut: 1_000_000n, slippageBps: MAINNET_SWAP_LIMITS.defaultSlippageBps, account });
  const v = spendableNativeYocto(account) - (probe.nativeNeedYocto - 1n);
  const max = v > 0n ? v : 0n;
  return max > cap ? cap : max;
}

export type BalanceCheck = 'ok' | 'insufficient_token' | 'insufficient_native_fee' | 'cap';
export function checkBalances(from: SwapAsset, amountIn: bigint, plan: SwapPlan, account: MainnetSwapAccountState): BalanceCheck {
  if (amountIn > MAINNET_SWAP_LIMITS.maxInput[from.token]) return 'cap';
  if (from.id !== 'near' && amountIn > balanceOf(from, account)) return 'insufficient_token';
  if (from.id === 'near' && amountIn > BigInt(account.nearYocto)) return 'insufficient_token';
  if (plan.nativeNeedYocto > spendableNativeYocto(account)) return 'insufficient_native_fee';
  return 'ok';
}

/** One step -> the planner operation. 'FROM_SWAP' resolves only from a verified swap output. */
export function stepOperation(step: SwapStep, swapId: string, swapOutput: string | null): MainnetSwapOperation {
  if (step.kind === 'register') return { kind: 'swapRegister', swapId, token: step.token };
  if (step.kind === 'wrap') return { kind: 'swapWrap', swapId, amountYocto: step.amount };
  if (step.kind === 'swap') return { kind: 'swapExact', swapId, tokenIn: step.tokenIn, tokenOut: step.tokenOut, amountIn: step.amountIn, minAmountOut: step.minOut };
  const amount = step.amount === 'FROM_SWAP' ? swapOutput : step.amount;
  if (amount === null || !/^[1-9][0-9]{0,38}$/.test(amount)) throw new Error('UNWRAP_AMOUNT_UNKNOWN');
  return { kind: 'swapUnwrap', swapId, amountYocto: amount };
}

export const SwapStepSchema = z.union([
  z.strictObject({ kind: z.literal('register'), token: z.enum([MAINNET_WRAP, MAINNET_USDC]) }),
  z.strictObject({ kind: z.literal('wrap'), amount: z.string().regex(/^[1-9][0-9]{0,38}$/) }),
  z.strictObject({ kind: z.literal('swap'), tokenIn: z.enum([MAINNET_WRAP, MAINNET_USDC]), tokenOut: z.enum([MAINNET_WRAP, MAINNET_USDC]), amountIn: z.string().regex(/^[1-9][0-9]{0,38}$/), minOut: z.string().regex(/^[1-9][0-9]{0,38}$/) }),
  z.strictObject({ kind: z.literal('unwrap'), amount: z.union([z.literal('FROM_SWAP'), z.string().regex(/^[1-9][0-9]{0,38}$/)]) }),
]);
