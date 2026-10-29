import { createNearTestnetClient, type ReadResult, type AccountSnapshot } from '@taply/near-client';
const client = createNearTestnetClient({ network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'public', contract: null });
const account: Promise<ReadResult<AccountSnapshot>> = client.readAccount('alice.testnet');
void account;
// @ts-expect-error No signer API.
client.signTransaction();
// @ts-expect-error No unrestricted RPC escape hatch.
client.rpc('broadcast_tx_commit');
// @ts-expect-error No mainnet support.
createNearTestnetClient({ network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.near.org', rpcProviderId: 'mainnet', contract: null });
