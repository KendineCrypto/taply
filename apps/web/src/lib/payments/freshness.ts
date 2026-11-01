/**
 * Freshness of a finalized-chain observation, for FINANCIAL actions only.
 *
 * A read can succeed at a final block that is old: a stalled (not "syncing")
 * provider keeps answering from its last block, and `checkedAt` only says when
 * we asked. Building request terms or authorizing a payment from such a block
 * would anchor expiry and eligibility to the past. So before either, the
 * block's own timestamp is compared with this device's clock.
 *
 * Policy (same as the native wallet backend in near-client): older than 90 s,
 * or more than 10 s in the future, is not usable. A failure here pauses
 * signing; it never means a payment failed.
 */

export const MAX_CHAIN_AGE_MS = 90_000;
export const MAX_CHAIN_FUTURE_MS = 10_000;

export type ChainFreshness = 'fresh' | 'stale' | 'future';

export function chainFreshness(blockTimestampNs: string, nowMs: number): ChainFreshness {
  let blockMs: bigint;
  try {
    blockMs = BigInt(blockTimestampNs) / 1_000_000n;
  } catch {
    return 'stale';
  }
  const now = BigInt(Math.trunc(nowMs));
  if (blockMs - now > BigInt(MAX_CHAIN_FUTURE_MS)) return 'future';
  if (now - blockMs > BigInt(MAX_CHAIN_AGE_MS)) return 'stale';
  return 'fresh';
}

/**
 * True when two verified contract configurations are identical. A change
 * between review and signing means the person must review again.
 */
export function sameContractConfig(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
      : typeof v === 'bigint'
        ? v.toString()
        : v,
  );
}
