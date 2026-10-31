import { createNearTestnetClient, type ReadResult, type AccountSnapshot, type NearTestnetClient } from '@taply/near-client';
const client = createNearTestnetClient({ network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'public', contract: null });
const account: Promise<ReadResult<AccountSnapshot>> = client.readAccount('alice.testnet');
void account;
const completeClient: NearTestnetClient = client;
void completeClient;
const observation = await client.observeTransaction({ transactionHash: '11111111111111111111111111111111', signerAccountId: 'alice.testnet' });
// @ts-expect-error Observing a transaction cannot produce a payment state.
observation.observation.data?.paymentState;
// @ts-expect-error Receipt evidence needs its transaction hash and signer too.
client.observeReceipt({ receiptId: '11111111111111111111111111111112' });
// @ts-expect-error No signer API.
client.signTransaction();
// @ts-expect-error No unrestricted RPC escape hatch.
client.rpc('broadcast_tx_commit');
// @ts-expect-error No mainnet support.
createNearTestnetClient({ network: 'near-mainnet', rpcUrl: 'https://rpc.mainnet.near.org', rpcProviderId: 'mainnet', contract: null });
// @ts-expect-error Contract views are a closed list; there is no arbitrary method escape hatch.
client.callView('withdraw', {});
const prepared: import('@taply/near-client').PreparedContractCall = { receiverId: 'p.testnet', methodName: 'cancel_unfunded', args: {}, gas: '1', depositYocto: '1' };
// @ts-expect-error A prepared call is only a description; it has no signing or sending method.
prepared.signAndSend();
// @ts-expect-error Only the four reviewed Instant Pay methods can be prepared.
const forbidden: import('@taply/near-client').PreparedContractCall['methodName'] = 'fund_protected_native';
void forbidden;
