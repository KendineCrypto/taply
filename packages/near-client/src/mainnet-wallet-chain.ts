import { z } from 'zod';
import { MainnetAccountSchema, U128Schema } from '@taply/shared';
import { AccountSchema, HashSchema, RpcU64Schema } from './validation.js';
import { NearClientError, type Fetch } from './rpc.js';
import { mainnetTransport, type MainnetReadProfile } from './mainnet-network.js';
import type { MainnetWalletSnapshot } from './mainnet-wallet-transfer.js';

const Key = z.object({ nonce: RpcU64Schema, permission: z.literal('FullAccess'), block_hash: HashSchema, block_height: RpcU64Schema });
/** Read-only activation and spending evidence. Never provisions or funds an account. */
export function createMainnetWalletChain(profile: MainnetReadProfile, fetcher: Fetch = (url, init) => globalThis.fetch(url, init)) {
  const { rpc, finalBlock } = mainnetTransport(profile, fetcher);
  return Object.freeze({ async snapshot(accountId: string, publicKey: string): Promise<MainnetWalletSnapshot | null> {
    MainnetAccountSchema.parse(accountId);
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKey)) throw new Error('INVALID_PUBLIC_KEY');
    const block = await finalBlock();
    let account;
    try { account = AccountSchema.parse(await rpc('query', { request_type: 'view_account', account_id: accountId, block_id: block.hash })); }
    catch (e) { if (e instanceof NearClientError && e.code === 'ACCOUNT_NOT_FOUND') return null; throw e; }
    const [rawKey, rawProtocol, rawGas] = await Promise.all([
      rpc('query', { request_type: 'view_access_key', account_id: accountId, public_key: publicKey, block_id: block.hash }),
      rpc('EXPERIMENTAL_protocol_config', { block_id: block.hash }), rpc('gas_price', [block.hash]),
    ]);
    const key = Key.parse(rawKey);
    if ([account, key].some(value => value.block_hash !== block.hash || value.block_height !== block.height))
      throw new NearClientError('EVIDENCE_MISMATCH');
    const protocol = z.object({ runtime_config: z.object({ storage_amount_per_byte: U128Schema }) }).parse(rawProtocol);
    const gas = z.object({ gas_price: U128Schema }).parse(rawGas);
    return Object.freeze({ network: 'near-mainnet', accountId, publicKey, nonce: key.nonce,
      blockHash: block.hash, blockHeight: block.height, blockTimestampNs: block.timestampNs,
      amountYocto: account.amount, storageUsageBytes: account.storage_usage,
      storageByteCostYocto: protocol.runtime_config.storage_amount_per_byte, gasPriceYocto: gas.gas_price });
  } });
}
