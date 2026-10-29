import type { NearTestnetConfig } from '@taply/near-client';

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

export type ChainConfigResult =
  | { readonly ok: true; readonly client: NearTestnetConfig; readonly explorerBaseUrl: string }
  | { readonly ok: false; readonly reason: 'wrong_network' | 'invalid_rpc_url' | 'invalid_explorer_url' };

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
}): ChainConfigResult {
  const network = env.network || 'near-testnet';
  if (network !== 'near-testnet') return { ok: false, reason: 'wrong_network' };

  const rpcUrl = env.rpcUrl || DEFAULT_TESTNET_RPC_URL;
  if (!isPlainHttpsUrl(rpcUrl)) return { ok: false, reason: 'invalid_rpc_url' };

  const explorerBaseUrl = (env.explorerBaseUrl || DEFAULT_EXPLORER_BASE_URL).replace(/\/+$/, '');
  if (!isPlainHttpsUrl(explorerBaseUrl)) return { ok: false, reason: 'invalid_explorer_url' };

  return {
    ok: true,
    explorerBaseUrl,
    client: {
      network: 'near-testnet',
      rpcUrl,
      rpcProviderId: env.rpcProviderId || DEFAULT_TESTNET_RPC_PROVIDER_ID,
      // No Taply contract deployment has been approved, so there is no code hash
      // to check. NEXT_PUBLIC_TAPLY_CONTRACT_ID is intentionally not read here.
      contract: null,
    },
  };
}

export const CHAIN_CONFIG: ChainConfigResult = resolveChainConfig({
  network: process.env.NEXT_PUBLIC_TAPLY_NETWORK,
  rpcUrl: process.env.NEXT_PUBLIC_TAPLY_RPC_URL,
  rpcProviderId: process.env.NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID,
  explorerBaseUrl: process.env.NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL,
});

/** Explorer evidence link for an account. Evidence to look at, not proof by itself. */
export function explorerAccountUrl(explorerBaseUrl: string, accountId: string): string {
  return `${explorerBaseUrl}/address/${encodeURIComponent(accountId)}`;
}
