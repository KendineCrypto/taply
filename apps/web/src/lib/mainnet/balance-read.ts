import { createMainnetAccountReader, MAINNET_RPC_URLS, NearClientError } from '@taply/near-client';

type Profile = Parameters<typeof createMainnetAccountReader>[0];
const TRANSIENT = new Set(['RPC_TIMEOUT', 'RPC_UNAVAILABLE', 'RPC_RATE_LIMITED', 'RPC_HTTP_ERROR', 'RPC_ERROR', 'SHARD_UNAVAILABLE', 'NODE_SYNCING', 'BLOCK_UNAVAILABLE']);

/** Display balances only. Each provider verifies Mainnet genesis and reads the
 * whole balance snapshot at its own FINAL block; evidence is never mixed.
 * This does not change the signer/planner RPC or weaken transaction checks. */
export async function readMainnetDisplayBalances(accountId: string, profile: Profile) {
  const urls = [profile.rpcUrl, ...MAINNET_RPC_URLS].filter((url, i, all) => all.indexOf(url) === i);
  for (const [i, rpcUrl] of urls.entries()) {
    try {
      return await createMainnetAccountReader({ ...profile, rpcUrl, rpcProviderId: i === 0 ? profile.rpcProviderId : `mainnet-balance-${i}`, timeoutMs: 8000 }).readBalances(accountId);
    } catch (error) {
      if (i === urls.length - 1 || !(error instanceof NearClientError) || !TRANSIENT.has(error.code)) throw error;
    }
  }
  throw new Error('No approved Mainnet balance provider');
}
