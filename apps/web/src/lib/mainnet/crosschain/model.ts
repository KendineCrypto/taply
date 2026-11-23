import { z } from 'zod';
import { MAINNET_USDC } from '@taply/shared';
import { validateEvmAddress, validateSolanaAddress } from '../oneclick/refund-address';

export const CHAINS = ['near', 'base', 'sol'] as const;
export type Chain = typeof CHAINS[number];
export const ASSETS = {
  near: { chain: 'near', name: 'NEAR', symbol: 'USDC', decimals: 6, contract: MAINNET_USDC, assetId: `nep141:${MAINNET_USDC}` },
  base: { chain: 'base', name: 'Base', symbol: 'USDC', decimals: 6, contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near' },
  sol: { chain: 'sol', name: 'Solana', symbol: 'USDC', decimals: 6, contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near' },
} as const;
export const Units = z.string().regex(/^[1-9][0-9]{0,8}$/).refine(s => BigInt(s) <= 100_000_000n);
export const Secret = z.string().regex(/^[a-f0-9]{64}$/);
export const SwapInput = z.strictObject({ from: z.enum(CHAINS), to: z.enum(CHAINS), amount: Units,
  recipient: z.string().min(2).max(128), refundTo: z.string().min(2).max(128), slippageBps: z.number().int().min(10).max(300) })
  .refine(v => v.from !== v.to);
export type SwapInput = z.infer<typeof SwapInput>;
export function address(chain: Chain, raw: string): string {
  const value = raw.trim();
  if (chain === 'near') {
    if (!/^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/.test(value) || value.length < 2 || value.length > 64 || value.endsWith('.testnet')) throw new Error('ADDRESS_INVALID');
    if (value === ASSETS.near.contract || value === 'intents.near' || value === 'system') throw new Error('ADDRESS_INVALID');
    return value;
  }
  const result = chain === 'base' ? validateEvmAddress(value) : validateSolanaAddress(value);
  if (!result.ok || result.address === '0x0000000000000000000000000000000000000000' || result.address === ASSETS[chain].contract) throw new Error('ADDRESS_INVALID');
  return result.address;
}
export function normalized(raw: unknown): SwapInput {
  const i = SwapInput.parse(raw);
  return { ...i, recipient: address(i.to, i.recipient), refundTo: address(i.from, i.refundTo) };
}
export function parseAmount(s: string): string | null {
  const value = s.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{0,6})?$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  const units = (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString();
  return Units.safeParse(units).success ? units : null;
}
export function formatAmount(units: string): string {
  if (!/^\d+$/.test(units)) return '—';
  const n = BigInt(units); return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0')}`;
}
export const PublicQuote = z.object({ input: SwapInput, correlationId: z.string(), amountIn: z.string().regex(/^\d+$/), amountOut: z.string().regex(/^\d+$/), minAmountOut: z.string().regex(/^\d+$/), deadline: z.string(), createdAt: z.number(), estimate: z.number().nullable(), deposit: z.string().nullable(), memo: z.string().nullable(), funded: z.boolean() });
export type PublicQuote = z.infer<typeof PublicQuote>;
export const Proof = z.object({ state: z.enum(['pending', 'verified']), amount: z.string().nullable(), chain: z.enum(CHAINS), txs: z.array(z.string()), trust: z.literal('configured-rpc') });
export type Proof = z.infer<typeof Proof>;
export const PublicSession = z.object({ quote: PublicQuote.nullable(), state: z.enum(['reserving', 'ready', 'uncertain']), upstream: z.string().nullable(), proof: Proof.nullable(), refundProof: Proof.nullable() });
export type PublicSession = z.infer<typeof PublicSession>;
export function txLink(chain: Chain, hash: string): string | null {
  if (chain === 'base') return /^0x[a-fA-F0-9]{64}$/.test(hash) ? `https://basescan.org/tx/${hash}` : null;
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(hash) ? `https://solscan.io/tx/${hash}` : null;
  return /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) ? `https://nearblocks.io/txns/${hash}` : null;
}
