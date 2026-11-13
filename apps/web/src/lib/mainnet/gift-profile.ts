import { MainnetGiftProfileSchema } from '@taply/near-client';
import type { MainnetGiftProfile } from '@taply/near-client';
import { MAINNET_CONFIG } from './config';

/**
 * Mainnet Gift contract profile from build-time env. ALL of account, pinned
 * code hash, min, max and fee must be set and pass Codex's
 * MainnetGiftProfileSchema; otherwise Gift is "not configured" (fail closed).
 * No Mainnet Gift account/fee/limits are owner-approved, so Production never
 * sets these (scripts/check-mainnet-env.mjs refuses them on Production).
 */
export function resolveGiftProfile(env: Readonly<Record<string, string | undefined>>, net: { readonly rpcUrl: string; readonly rpcProviderId: string } | null = MAINNET_CONFIG.ok ? MAINNET_CONFIG : null): MainnetGiftProfile | null {
  if (net === null) return null;
  const candidate = {
    network: 'near-mainnet' as const, rpcUrl: net.rpcUrl, rpcProviderId: net.rpcProviderId,
    contract: {
      accountId: env['contractId'] ?? '', expectedCodeHash: env['codeHash'] ?? '',
      minAmountYocto: env['min'] ?? '', maxAmountYocto: env['max'] ?? '', giftFeeYocto: env['fee'] ?? '',
    },
  };
  const parsed = MainnetGiftProfileSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export const GIFT_PROFILE: MainnetGiftProfile | null = resolveGiftProfile({
  contractId: process.env.NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID,
  codeHash: process.env.NEXT_PUBLIC_TAPLY_GIFT_CODE_HASH,
  min: process.env.NEXT_PUBLIC_TAPLY_GIFT_MIN_YOCTO,
  max: process.env.NEXT_PUBLIC_TAPLY_GIFT_MAX_YOCTO,
  fee: process.env.NEXT_PUBLIC_TAPLY_GIFT_FEE_YOCTO,
});
