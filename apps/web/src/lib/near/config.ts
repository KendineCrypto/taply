import type { NearTestnetConfig } from '@taply/near-client';
import { AccountIdSchema } from '@/lib/protocol';

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
      readonly explorerBaseUrl: string;
      readonly contract: ContractSetting;
    }
  | { readonly ok: false; readonly reason: 'wrong_network' | 'invalid_rpc_url' | 'invalid_explorer_url' };

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

  return {
    ok: true,
    explorerBaseUrl,
    contract,
    client: {
      network: 'near-testnet',
      rpcUrl,
      rpcProviderId: env.rpcProviderId || DEFAULT_TESTNET_RPC_PROVIDER_ID,
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
