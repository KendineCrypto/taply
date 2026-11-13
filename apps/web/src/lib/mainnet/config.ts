import { MAINNET_EXPLORER, MAINNET_RPC_URLS, MainnetProfileSchema } from '@taply/near-client';
import type { MainnetProfile } from '@taply/near-client';
import { MainnetContractIdSchema } from '@taply/shared';
import { validateShareOrigin } from '@/lib/share/origin';
import { MAINNET_SIGNING_RELEASE_APPROVED } from './release-gates';

/**
 * Mainnet build-time profile for the web app (docs/MAINNET.md "Constructor and
 * network"). Pure, so it is tested without touching process.env.
 *
 * Fail closed: the contract is usable only with an approved account
 * (`taply-pay.kendinecrypto.near` or staging `devkendinecrypto.near`) AND a
 * pinned code hash that @taply/near-client accepts. The CI candidate hash in
 * docs is NOT a deployed hash; the value here must be the one read back from
 * chain after deployment (docs/MAINNET_INFRA.md §1.6).
 */
export type MainnetContractSetting =
  | { readonly status: 'not_configured' }
  | { readonly status: 'invalid'; readonly reason: 'account' | 'code_hash' | 'half_set' }
  | { readonly status: 'configured'; readonly accountId: string; readonly expectedCodeHash: string };

export type MainnetConfig =
  | {
      readonly ok: true;
      readonly network: 'near-mainnet';
      readonly rpcUrl: (typeof MAINNET_RPC_URLS)[number];
      readonly rpcProviderId: string;
      readonly explorerBaseUrl: typeof MAINNET_EXPLORER;
      readonly contract: MainnetContractSetting;
      /** Profile for createMainnetReader, or null while no contract is pinned. */
      readonly profile: MainnetProfile | null;
      readonly shareOrigin: string | null;
      /** Controlled fixture data instead of chain reads (never on Production; see check-mainnet-env). */
      readonly fixtures: boolean;
      /** Env flag AND compile-time release gate. False today by construction. */
      readonly signingEnabled: boolean;
    }
  | { readonly ok: false; readonly reason: 'not_mainnet' | 'invalid_rpc' | 'invalid_explorer' };

export function resolveMainnetConfig(env: {
  readonly network?: string | undefined;
  readonly rpcUrl?: string | undefined;
  readonly rpcProviderId?: string | undefined;
  readonly explorerBaseUrl?: string | undefined;
  readonly contractId?: string | undefined;
  readonly contractCodeHash?: string | undefined;
  readonly shareOrigin?: string | undefined;
  readonly fixtures?: string | undefined;
  readonly signing?: string | undefined;
}): MainnetConfig {
  if (env.network !== 'near-mainnet') return { ok: false, reason: 'not_mainnet' };
  // No default RPC: the Testnet defaults must never apply on mainnet.
  const rpcUrl = MAINNET_RPC_URLS.find((u) => u === env.rpcUrl);
  if (rpcUrl === undefined || !env.rpcProviderId || !/^[a-zA-Z0-9._-]{1,64}$/.test(env.rpcProviderId)) {
    return { ok: false, reason: 'invalid_rpc' };
  }
  if ((env.explorerBaseUrl ?? '').replace(/\/+$/, '') !== MAINNET_EXPLORER) return { ok: false, reason: 'invalid_explorer' };

  let contract: MainnetContractSetting = { status: 'not_configured' };
  let profile: MainnetProfile | null = null;
  if (env.contractId || env.contractCodeHash) {
    if (!env.contractId || !env.contractCodeHash) contract = { status: 'invalid', reason: 'half_set' };
    else if (!MainnetContractIdSchema.safeParse(env.contractId).success) contract = { status: 'invalid', reason: 'account' };
    else {
      const candidate: MainnetProfile = {
        network: 'near-mainnet',
        rpcUrl,
        rpcProviderId: env.rpcProviderId,
        contract: { accountId: env.contractId as MainnetProfile['contract']['accountId'], expectedCodeHash: env.contractCodeHash },
      };
      if (MainnetProfileSchema.safeParse(candidate).success) {
        contract = { status: 'configured', accountId: env.contractId, expectedCodeHash: env.contractCodeHash };
        profile = candidate;
      } else contract = { status: 'invalid', reason: 'code_hash' };
    }
  }

  return {
    ok: true,
    network: 'near-mainnet',
    rpcUrl,
    rpcProviderId: env.rpcProviderId,
    explorerBaseUrl: MAINNET_EXPLORER,
    contract,
    profile,
    shareOrigin: validateShareOrigin(env.shareOrigin ?? null),
    fixtures: env.fixtures === 'on',
    signingEnabled: env.signing === 'on' && MAINNET_SIGNING_RELEASE_APPROVED,
  };
}

export const MAINNET_CONFIG: MainnetConfig = resolveMainnetConfig({
  network: process.env.NEXT_PUBLIC_TAPLY_NETWORK,
  rpcUrl: process.env.NEXT_PUBLIC_TAPLY_RPC_URL,
  rpcProviderId: process.env.NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID,
  explorerBaseUrl: process.env.NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL,
  contractId: process.env.NEXT_PUBLIC_TAPLY_CONTRACT_ID,
  contractCodeHash: process.env.NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH,
  shareOrigin: process.env.NEXT_PUBLIC_TAPLY_SHARE_ORIGIN,
  fixtures: process.env.NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES,
  signing: process.env.NEXT_PUBLIC_TAPLY_MAINNET_SIGNING,
});
