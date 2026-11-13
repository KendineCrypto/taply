import { z } from 'zod';
import { MainnetAccountSchema, MAINNET_USDC, U128Schema, U64Schema, parseStrictJson } from '@taply/shared';
import { MAINNET_GENESIS_HASH, MAINNET_GENESIS_HEIGHT, MAINNET_RPC_URLS } from './mainnet.js';
import { createRpc, NearClientError, type Fetch } from './rpc.js';
import { HashSchema, CallResultSchema, AccountSchema } from './validation.js';

const Profile = z.strictObject({ network: z.literal('near-mainnet'), rpcUrl: z.enum(MAINNET_RPC_URLS),
  rpcProviderId: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  timeoutMs: z.number().int().min(100).max(30000).default(10000),
  maxResponseBytes: z.number().int().min(1024).max(4194304).default(1048576) });
const Block = z.object({ header: z.object({ hash: HashSchema, timestamp_nanosec: U64Schema }) });
/** Account-only reads do not require a deployed Taply contract. These are RPC
 * observations, not independent payment receipts or spendable-balance quotes. */
export function createMainnetAccountReader(input: z.input<typeof Profile>, fetcher: Fetch = (url, init) => globalThis.fetch(url, init)) {
  const config = Profile.parse(input);
  const rpc = createRpc({ ...config, contract: null }, fetcher);
  return Object.freeze({ async readBalances(accountId: string) {
    const account = MainnetAccountSchema.parse(accountId);
    const status = z.object({ chain_id: z.literal('mainnet'), sync_info: z.object({ syncing: z.literal(false) }) }).safeParse(await rpc('status', []));
    const genesis = Block.parse(await rpc('block', { block_id: MAINNET_GENESIS_HEIGHT }));
    if (!status.success || genesis.header.hash !== MAINNET_GENESIS_HASH) throw new NearClientError('NETWORK_MISMATCH');
    const block = Block.parse(await rpc('block', { finality: 'final' })).header;
    const native = AccountSchema.parse(await rpc('query', {
      request_type: 'view_account', account_id: account, block_id: block.hash,
    }));
    const result = CallResultSchema.parse(await rpc('query', {
      request_type: 'call_function', account_id: MAINNET_USDC, method_name: 'ft_balance_of',
      args_base64: btoa(JSON.stringify({ account_id: account })), block_id: block.hash,
    }));
    if (native.block_hash !== block.hash || result.block_hash !== block.hash) throw new NearClientError('EVIDENCE_MISMATCH');
    const usdc = U128Schema.parse(parseStrictJson(new Uint8Array(result.result)));
    return { accountId: account, native: native.amount, locked: native.locked, usdc,
      blockHash: block.hash, timestampNs: block.timestamp_nanosec, source: 'rpc' as const,
      finality: 'final' as const, network: 'near-mainnet' as const, providerId: config.rpcProviderId };
  } });
}
