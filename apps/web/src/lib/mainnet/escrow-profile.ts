import { MainnetEscrowProfileSchema } from '@taply/near-client';
import type { MainnetEscrowProfile } from '@taply/near-client';
import { MAINNET_CONFIG } from './config';

/**
 * Mainnet Protected Pay escrow profile from build-time env: account + pinned
 * code hash, both required, validated by Codex's MainnetEscrowProfileSchema
 * (which already refuses the G1 pilot, staging, recovery and router accounts).
 * No Mainnet escrow is deployed or approved, so Production never sets these
 * (scripts/check-mainnet-env.mjs refuses them). Distinct from the Testnet
 * NEXT_PUBLIC_TAPLY_PROTECTED_* variables on purpose.
 */
export function resolveEscrowProfile(env: Readonly<Record<string, string | undefined>>): MainnetEscrowProfile | null {
  if (!MAINNET_CONFIG.ok) return null;
  const candidate = {
    network: 'near-mainnet' as const, rpcUrl: MAINNET_CONFIG.rpcUrl, rpcProviderId: MAINNET_CONFIG.rpcProviderId,
    contract: { accountId: env['contractId'] ?? '', expectedCodeHash: env['codeHash'] ?? '' },
  };
  return MainnetEscrowProfileSchema.safeParse(candidate).success ? candidate : null;
}

export const ESCROW_PROFILE: MainnetEscrowProfile | null = resolveEscrowProfile({
  contractId: process.env.NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID,
  codeHash: process.env.NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CODE_HASH,
});

/** Creation nonce: 32 random bytes as lowercase hex (feeds the request-id derivation). */
export function randomCreationNonce(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const CANCEL_MINUTES = { min: 1, max: 60 } as const;
export const FUNDING_MINUTES = { min: 5, max: 1440 } as const;

/** Whole minutes in [min, max] → nanoseconds string; anything else → null. */
export function minutesToNs(text: string, range: { readonly min: number; readonly max: number }): string | null {
  if (!/^[0-9]{1,4}$/.test(text.trim())) return null;
  const n = BigInt(text.trim());
  if (n < BigInt(range.min) || n > BigInt(range.max)) return null;
  return (n * 60_000_000_000n).toString();
}
