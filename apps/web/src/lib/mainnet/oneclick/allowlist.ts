/**
 * Origin assets Taply accepts for a 1Click quote. Explicit, minimal, Base USDC
 * only for the pilot (owner scope 2026-11-13). Arbitrum/Solana are listed in
 * docs/MAINNET_BRIEF.md §3 but deliberately NOT enabled here.
 *
 * In `dry` mode the service additionally confirms the asset is still listed by
 * the live `/v0/tokens` endpoint with the same chain and contract address.
 */
export type OriginChain = 'base' | 'sol' | 'tron';
export type RefundFormat = 'evm' | 'solana' | 'tron';

export interface OriginAsset {
  readonly assetId: string;
  /** 1Click `TokenResponse.blockchain` value (SDK 0.1.26 enum). */
  readonly chain: OriginChain;
  readonly symbol: 'USDC' | 'USDT';
  readonly decimals: 6;
  /** Token contract on the origin chain: EVM lowercase hex; Solana mint / Tron base58 exact. */
  readonly contractAddress: string;
  readonly refundAddressFormat: RefundFormat;
}

/**
 * Solana and Tron (owner scope 2026-11-13). Each entry pins the chain, symbol,
 * decimals and the token contract. The 1Click asset ID is NOT written here: it
 * is resolved from 1Click's own `/v0/tokens` list and only an exact, unique
 * match is offered. No route is invented; if 1Click does not list the token
 * identically, the chain is simply not offered.
 *  - Solana: Circle USDC mint.
 *  - Tron: Tether USDT (Circle no longer issues USDC on Tron); the merchant
 *    still receives exactly the requested USDC on NEAR (EXACT_OUTPUT swap).
 */
export interface DynamicOrigin extends Omit<OriginAsset, 'assetId'> {
  readonly key: 'solana-usdc' | 'tron-usdt';
}
export const DYNAMIC_ORIGINS: ReadonlyArray<DynamicOrigin> = Object.freeze([
  Object.freeze({ key: 'solana-usdc', chain: 'sol', symbol: 'USDC', decimals: 6, contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', refundAddressFormat: 'solana' }),
  Object.freeze({ key: 'tron-usdt', chain: 'tron', symbol: 'USDT', decimals: 6, contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', refundAddressFormat: 'tron' }),
] as const);

/** Base USDC: asset ID also confirmed by the recorded live dry quote (docs/evidence/mainnet-audit-2026-11-13). */
export const BASE_USDC: OriginAsset = Object.freeze({
  assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  chain: 'base',
  symbol: 'USDC',
  decimals: 6,
  contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  refundAddressFormat: 'evm',
});

export const ORIGIN_ASSET_ALLOWLIST: ReadonlyArray<OriginAsset> = Object.freeze([BASE_USDC]);

export function originAssetById(assetId: unknown): OriginAsset | null {
  return ORIGIN_ASSET_ALLOWLIST.find((a) => a.assetId === assetId) ?? null;
}

/** Shape of one `/v0/tokens` entry that matters here. */
export interface ListedToken {
  readonly assetId: string;
  readonly blockchain: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly contractAddress?: string | undefined;
}

const sameContract = (asset: Pick<OriginAsset, 'refundAddressFormat' | 'contractAddress'>, listed: string | undefined) =>
  asset.refundAddressFormat === 'evm' ? (listed ?? '').toLowerCase() === asset.contractAddress : listed === asset.contractAddress;

const describes = (asset: Omit<OriginAsset, 'assetId'>, t: ListedToken) =>
  t.blockchain === asset.chain && t.symbol === asset.symbol && t.decimals === asset.decimals && sameContract(asset, t.contractAddress);

/** The live token list must still describe the allowlisted asset identically. */
export function isStillListed(asset: OriginAsset, tokens: ReadonlyArray<ListedToken>): boolean {
  return tokens.some((t) => t.assetId === asset.assetId && describes(asset, t));
}

/** Resolves each dynamic origin to the asset ID 1Click lists for it; exactly one match or none. */
export function resolveDynamicOrigins(tokens: ReadonlyArray<ListedToken>): ReadonlyArray<OriginAsset & { readonly key: DynamicOrigin['key'] }> {
  const out: Array<OriginAsset & { readonly key: DynamicOrigin['key'] }> = [];
  for (const d of DYNAMIC_ORIGINS) {
    const matches = tokens.filter((t) => describes(d, t) && /^nep(141|245):[a-z0-9._:-]{1,140}$/.test(t.assetId));
    if (matches.length === 1) out.push({ key: d.key, chain: d.chain, symbol: d.symbol, decimals: d.decimals, contractAddress: d.contractAddress, refundAddressFormat: d.refundAddressFormat, assetId: matches[0]!.assetId });
  }
  return out;
}

/** Static allowlist first; otherwise a dynamic origin whose live-resolved asset ID equals the request. */
export function originFromTokens(assetId: unknown, tokens: ReadonlyArray<ListedToken>): OriginAsset | null {
  return originAssetById(assetId) ?? resolveDynamicOrigins(tokens).find((o) => o.assetId === assetId) ?? null;
}
