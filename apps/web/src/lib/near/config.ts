import type { NearTestnetConfig } from '@taply/near-client';
import { AccountIdSchema } from '@/lib/protocol';
import { DEFAULT_FALLBACK_VERIFIER } from '@/lib/verify/fallback';

/**
 * Frontend chain configuration.
 *
 * SECURITY.md section 1 / ARCHITECTURE.md "Network & signing": the logical
 * environment is hard-wired to NEAR Testnet. There is no mainnet branch to fall
 * back to. A misconfigured build fails closed: chain reads are disabled and
 * the UI says so, rather than silently pointing at another network.
 *
 * `@taply/near-client` re-validates all of this (HTTPS, no credentials, pinned
 * Testnet genesis hash on every read), so this layer only decides what to pass.
 */

export const DEFAULT_TESTNET_RPC_URL = 'https://rpc.testnet.near.org';
export const DEFAULT_TESTNET_RPC_PROVIDER_ID = 'near-public-testnet';
export const DEFAULT_EXPLORER_BASE_URL = 'https://testnet.nearblocks.io';

/**
 * The Taply payments contract this build may talk to.
 *
 * Fail closed: both the account ID and the human-approved code hash must be set
 * and valid. One without the other, or anything malformed, disables every
 * contract read and transaction rather than guessing. There is no default.
 */
export type ContractSetting =
  | { readonly status: 'not_configured' }
  | { readonly status: 'invalid' }
  | { readonly status: 'configured'; readonly accountId: string; readonly expectedCodeHash: string };

export type ChainConfigResult =
  | {
      readonly ok: true;
      readonly client: NearTestnetConfig;
      /**
       * RPC for the read-only receipt verifier and funding locator. Defaults to
       * the main RPC. A separate archival endpoint here keeps routine contract
       * reads (polling) off a provider that rate-limits hard, and only uses it
       * where old blocks are needed. The verifier checks the Testnet genesis
       * hash and the approved code hash on this RPC itself, and every
       * VerifiedReceipt names the provider it was checked through.
       */
      readonly verifier: { readonly rpcUrl: string; readonly rpcProviderId: string };
      /**
       * Second read-only archival provider, tried only when the verifier RPC
       * fails transiently; each proof still comes from ONE provider. Default:
       * FastNEAR archival unless it already is the verifier; 'off' disables.
       */
      readonly verifierFallback: { readonly rpcUrl: string; readonly rpcProviderId: string } | null;
      readonly explorerBaseUrl: string;
      readonly contract: ContractSetting;
    }
  | {
      readonly ok: false;
      readonly reason: 'wrong_network' | 'invalid_rpc_url' | 'invalid_explorer_url' | 'invalid_verifier_rpc';
    };

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A NEAR code hash: base58 that decodes to exactly 32 bytes. */
export function isCodeHash(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let decoded = 0n;
  for (const char of value) decoded = decoded * 58n + BigInt(BASE58.indexOf(char));
  let bytes = 0;
  for (let rest = decoded; rest > 0n; rest >>= 8n) bytes++;
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}

export function resolveContractSetting(accountId: string | undefined, codeHash: string | undefined): ContractSetting {
  if (!accountId && !codeHash) return { status: 'not_configured' };
  if (!accountId || !codeHash) return { status: 'invalid' };
  if (!AccountIdSchema.safeParse(accountId).success || !isCodeHash(codeHash)) return { status: 'invalid' };
  return { status: 'configured', accountId, expectedCodeHash: codeHash };
}

/** Same rule as @taply/near-client's rpcProviderId. */
const PROVIDER_ID = /^[a-zA-Z0-9._-]{1,64}$/;

function isPlainHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
}

/**
 * Pure so it can be tested without touching `process.env`. Empty strings are
 * treated as "unset", because that is how an untouched `.env.example` line looks.
 */
export function resolveChainConfig(env: {
  readonly network?: string | undefined;
  readonly rpcUrl?: string | undefined;
  readonly rpcProviderId?: string | undefined;
  readonly explorerBaseUrl?: string | undefined;
  readonly verifierRpcUrl?: string | undefined;
  readonly verifierRpcProviderId?: string | undefined;
  readonly verifierFallbackRpcUrl?: string | undefined;
  readonly verifierFallbackRpcProviderId?: string | undefined;
  readonly contractId?: string | undefined;
  readonly contractCodeHash?: string | undefined;
}): ChainConfigResult {
  const network = env.network || 'near-testnet';
  if (network !== 'near-testnet') return { ok: false, reason: 'wrong_network' };

  const rpcUrl = env.rpcUrl || DEFAULT_TESTNET_RPC_URL;
  if (!isPlainHttpsUrl(rpcUrl)) return { ok: false, reason: 'invalid_rpc_url' };

  const explorerBaseUrl = (env.explorerBaseUrl || DEFAULT_EXPLORER_BASE_URL).replace(/\/+$/, '');
  if (!isPlainHttpsUrl(explorerBaseUrl)) return { ok: false, reason: 'invalid_explorer_url' };

  const contract = resolveContractSetting(env.contractId, env.contractCodeHash);
  const rpcProviderId = env.rpcProviderId || DEFAULT_TESTNET_RPC_PROVIDER_ID;

  // Fail closed: a verifier RPC that is set must be valid and named, or nothing runs.
  let verifier = { rpcUrl, rpcProviderId };
  if (env.verifierRpcUrl || env.verifierRpcProviderId) {
    if (
      !env.verifierRpcUrl ||
      !isPlainHttpsUrl(env.verifierRpcUrl) ||
      !env.verifierRpcProviderId ||
      !PROVIDER_ID.test(env.verifierRpcProviderId)
    ) {
      return { ok: false, reason: 'invalid_verifier_rpc' };
    }
    verifier = { rpcUrl: env.verifierRpcUrl, rpcProviderId: env.verifierRpcProviderId };
  }

  let verifierFallback: { rpcUrl: string; rpcProviderId: string } | null = { ...DEFAULT_FALLBACK_VERIFIER };
  if (env.verifierFallbackRpcUrl === 'off') verifierFallback = null;
  else if (env.verifierFallbackRpcUrl || env.verifierFallbackRpcProviderId) {
    if (!env.verifierFallbackRpcUrl || !isPlainHttpsUrl(env.verifierFallbackRpcUrl)
      || !env.verifierFallbackRpcProviderId || !PROVIDER_ID.test(env.verifierFallbackRpcProviderId)) {
      return { ok: false, reason: 'invalid_verifier_rpc' };
    }
    verifierFallback = { rpcUrl: env.verifierFallbackRpcUrl, rpcProviderId: env.verifierFallbackRpcProviderId };
  }
  if (verifierFallback !== null && verifierFallback.rpcUrl === verifier.rpcUrl) verifierFallback = null;

  return {
    ok: true,
    explorerBaseUrl,
    contract,
    verifier,
    verifierFallback,
    client: {
      network: 'near-testnet',
      rpcUrl,
      rpcProviderId,
      // Only a complete, valid (account, code hash) pair reaches the client, which
      // then checks that code hash at the same finalized block as every view.
      contract:
        contract.status === 'configured'
          ? { accountId: contract.accountId, expectedCodeHash: contract.expectedCodeHash }
          : null,
    },
  };
}

export const CHAIN_CONFIG: ChainConfigResult = resolveChainConfig({
  network: process.env.NEXT_PUBLIC_TAPLY_NETWORK,
  rpcUrl: process.env.NEXT_PUBLIC_TAPLY_RPC_URL,
  rpcProviderId: process.env.NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID,
  explorerBaseUrl: process.env.NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL,
  verifierRpcUrl: process.env.NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL,
  verifierRpcProviderId: process.env.NEXT_PUBLIC_TAPLY_VERIFIER_RPC_PROVIDER_ID,
  verifierFallbackRpcUrl: process.env.NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_URL,
  verifierFallbackRpcProviderId: process.env.NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_PROVIDER_ID,
  contractId: process.env.NEXT_PUBLIC_TAPLY_CONTRACT_ID,
  contractCodeHash: process.env.NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH,
});

/** Explorer evidence link for an account. Evidence to look at, not proof by itself. */
export function explorerAccountUrl(explorerBaseUrl: string, accountId: string): string {
  return `${explorerBaseUrl}/address/${encodeURIComponent(accountId)}`;
}

/** Explorer evidence link for a transaction. Evidence to look at, not proof by itself. */
export function explorerTransactionUrl(explorerBaseUrl: string, transactionHash: string): string {
  return `${explorerBaseUrl}/txns/${encodeURIComponent(transactionHash)}`;
}

/**
 * Provider order for the receipt verifier and the funding locator.
 *
 * Measured on the real payment 7nb5J2Ss… (2026-11-09): one full proof took ~40 s on
 * archival-rpc.testnet.near.org (and browsers saw HTTP 429 without CORS headers,
 * i.e. an opaque network error) vs ~2.4 s on FastNEAR archival. So the FastNEAR
 * archival endpoint (`verifierFallback`) is tried FIRST and the configured
 * verifier becomes the whole-proof fallback. Each proof still comes from one
 * provider; with the fallback set to 'off' the configured verifier is used alone.
 */
export function verifierProviders(config: Extract<ChainConfigResult, { ok: true }>): {
  readonly primary: { readonly rpcUrl: string; readonly rpcProviderId: string };
  readonly secondary: { readonly rpcUrl: string; readonly rpcProviderId: string } | null;
} {
  return config.verifierFallback === null
    ? { primary: config.verifier, secondary: null }
    : { primary: config.verifierFallback, secondary: config.verifier };
}
