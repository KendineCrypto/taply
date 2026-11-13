/**
 * Origin assets Taply accepts for a 1Click quote. Explicit, minimal, Base USDC
 * only for the pilot (owner scope 2026-11-13). Arbitrum/Solana are listed in
 * docs/MAINNET_BRIEF.md §3 but deliberately NOT enabled here.
 *
 * In `dry` mode the service additionally confirms the asset is still listed by
 * the live `/v0/tokens` endpoint with the same chain and contract address.
 */
export interface OriginAsset {
  readonly assetId: string;
  readonly chain: 'base';
  readonly symbol: 'USDC';
  readonly decimals: 6;
  /** Canonical ERC-20 contract on Base (Circle native USDC), lowercase. */
  readonly contractAddress: string;
  readonly refundAddressFormat: 'evm';
}

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

/** The live token list must still describe the allowlisted asset identically. */
export function isStillListed(asset: OriginAsset, tokens: ReadonlyArray<ListedToken>): boolean {
  return tokens.some(
    (t) =>
      t.assetId === asset.assetId &&
      t.blockchain === asset.chain &&
      t.symbol === asset.symbol &&
      t.decimals === asset.decimals &&
      (t.contractAddress ?? '').toLowerCase() === asset.contractAddress,
  );
}
