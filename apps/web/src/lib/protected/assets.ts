import type { ProtectedContractConfig } from '@taply/near-client';
import { NEAR_NATIVE } from '@/lib/protocol';
import type { DisplayAsset } from '@/lib/protocol';

/**
 * Display data for a request's asset. Native NEAR is fixed; a NEP-141 token is
 * shown ONLY if the contract's own verified allowlist (get_config, read at a
 * code-hash-anchored final block) names it. Anything else is unsupported:
 * never shown as NEAR, never guessed from the token's own metadata.
 */
export function displayAssetFor(assetId: string, config: ProtectedContractConfig | null): DisplayAsset | null {
  if (assetId === NEAR_NATIVE.id) return NEAR_NATIVE;
  const token = config?.tokens?.find((t) => t.assetId === assetId);
  return token === undefined ? null : { id: token.assetId, symbol: token.symbol, decimals: token.decimals };
}

/** Assets a new request may use on this contract: NEAR plus the verified allowlist. */
export function selectableAssets(config: ProtectedContractConfig | null): DisplayAsset[] {
  return [NEAR_NATIVE, ...(config?.tokens ?? []).map((t) => ({ id: t.assetId, symbol: t.symbol, decimals: t.decimals }))];
}
