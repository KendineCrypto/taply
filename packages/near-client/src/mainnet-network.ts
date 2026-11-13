import { z } from 'zod';
import { MAINNET_GENESIS_HASH, MAINNET_GENESIS_HEIGHT, MAINNET_RPC_URLS } from './mainnet.js';
import { createRpc, NearClientError, type Fetch } from './rpc.js';
import { BlockSchema } from './validation.js';

export const MainnetReadProfileSchema = z.strictObject({ network: z.literal('near-mainnet'),
  rpcUrl: z.enum(MAINNET_RPC_URLS), rpcProviderId: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  timeoutMs: z.number().int().min(100).max(30000).default(10000),
  maxResponseBytes: z.number().int().min(1024).max(4194304).default(1048576) });
export type MainnetReadProfile = z.input<typeof MainnetReadProfileSchema>;
/** Internal transport. Checking a hostname is not checking its network. */
export function mainnetTransport(input: MainnetReadProfile, fetcher: Fetch) {
  const config = MainnetReadProfileSchema.parse(input);
  const rpc = createRpc({ ...config, contract: null }, fetcher);
  async function checkNetwork() {
    const status = z.object({ chain_id: z.literal('mainnet'), sync_info: z.object({ syncing: z.literal(false) }) })
      .safeParse(await rpc('status', []));
    const genesis = BlockSchema.parse(await rpc('block', { block_id: MAINNET_GENESIS_HEIGHT }));
    if (!status.success || genesis.hash !== MAINNET_GENESIS_HASH || genesis.height !== String(MAINNET_GENESIS_HEIGHT))
      throw new NearClientError('NETWORK_MISMATCH');
  }
  return { config, rpc, checkNetwork, async finalBlock() {
    await checkNetwork(); return BlockSchema.parse(await rpc('block', { finality: 'final' }));
  } };
}
