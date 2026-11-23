// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deliveryVerifier } from '../proof';
import { ASSETS } from '@/lib/mainnet/crosschain/model';
const recipient='0x'+'1'.repeat(40), hash='0x'+'a'.repeat(64), blockHash='0x'+'b'.repeat(64);
function fake(over: { chain?: string; amount?: string; status?: string; canonical?: string; timestamp?: string; to?: string; contract?: string } = {}) {
  return (async (_u, init) => {
    const {method} = JSON.parse(String(init?.body));
    const result = method==='eth_chainId' ? over.chain??'0x2105' : method==='eth_getBlockByNumber' ? {number:'0x10',hash:over.canonical??blockHash,timestamp:over.timestamp??'0x100'} : {transactionHash:hash,status:over.status??'0x1',blockNumber:'0x10',blockHash,logs:[{address:over.contract??ASSETS.base.contract,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+'0'.repeat(64),'0x'+'0'.repeat(24)+(over.to??recipient).slice(2)],data:over.amount??'0xf4240',transactionHash:hash,blockHash}]};
    return Response.json({jsonrpc:'2.0',id:1,result});
  }) as typeof fetch;
}
describe('final Base USDC delivery proof',()=>{
  it('verifies exact token, recipient, amount, network and canonical finalized block',async()=>expect(await deliveryVerifier({},fake())('base',recipient,'1000000',[hash],0)).toMatchObject({state:'verified',amount:'1000000'}));
  it.each([{chain:'0x1'},{status:'0x0'},{amount:'0x1'},{canonical:'0x'+'c'.repeat(64)},{to:'0x'+'2'.repeat(40)},{contract:'0x'+'3'.repeat(40)}])('never confirms mismatched evidence %j',async over=>expect(await deliveryVerifier({},fake(over))('base',recipient,'1000000',[hash],0)).toMatchObject({state:'pending'}));
  it('deduplicates transaction references',async()=>expect(await deliveryVerifier({},fake())('base',recipient,'1500000',[hash,hash],0)).toMatchObject({state:'pending'}));
  it('rejects a transfer that predates the quote',async()=>expect(await deliveryVerifier({},fake())('base',recipient,'1',[hash],9999999999999)).toMatchObject({state:'pending'}));
  it('RPC outage never becomes successful delivery',async()=>expect(await deliveryVerifier({},async()=>{throw Error('timeout');})('base',recipient,'1',[hash],0)).toMatchObject({state:'pending'}));
  it('missing destination hash is pending, not success',async()=>expect(await deliveryVerifier({},fake())('base',recipient,'1',[],0)).toMatchObject({state:'pending'}));
});

const solHash = '3'.repeat(88), solOwner = '7'.repeat(44);
function solFake(over: { genesis?: string; owner?: string; mint?: string; amount?: string; err?: object; signature?: string; time?: number } = {}) {
  return (async (_u, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    if (method === 'getTransaction') expect(params[1].commitment).toBe('finalized');
    return Response.json({ result: method === 'getGenesisHash' ? over.genesis ?? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' : {
      blockTime: over.time ?? 1000, transaction: { signatures: [over.signature ?? solHash] }, meta: { err: over.err ?? null, preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint: over.mint ?? ASSETS.sol.contract, owner: over.owner ?? solOwner, uiTokenAmount: { amount: over.amount ?? '1000000', decimals: 6 } }] },
    } });
  }) as typeof fetch;
}
describe('final Solana USDC evidence', () => {
  it('requires finalized recipient balance increase', async () => expect(await deliveryVerifier({}, solFake())('sol', solOwner, '1000000', [solHash], 0)).toMatchObject({ state: 'verified', amount: '1000000' }));
  it.each([{ genesis: 'devnet' }, { owner: 'another-owner' }, { mint: 'another-mint' }, { amount: '1' }, { err: { InstructionError: [0] } }, { signature: '4'.repeat(88) }, { time: 0 }])('rejects wrong or stale evidence %j', async over => expect(await deliveryVerifier({}, solFake(over))('sol', solOwner, '1000000', [solHash], 1)).toMatchObject({ state: 'pending' }));
});

import { MAINNET_GENESIS_HASH, MAINNET_GENESIS_HEIGHT } from '@taply/near-client';
const nearHash = '4'.repeat(44), nearBlock = '5'.repeat(44), pin = '6'.repeat(44);
function nearFake(over: { code?: string; chain?: string; orphan?: boolean; owner?: string; status?: object; missing?: boolean } = {}) {
  return (async (_u, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    const receipt = { id: 'receipt', block_hash: nearBlock, outcome: { executor_id: ASSETS.near.contract, receipt_ids: [], status: over.status ?? { SuccessValue: '' }, logs: ['EVENT_JSON:' + JSON.stringify({ standard: 'nep141', event: 'ft_transfer', version: '1.0.0', data: [{ new_owner_id: over.owner ?? 'alice.near', amount: '1000000' }] })] } };
    const result = method === 'status' ? { chain_id: over.chain ?? 'mainnet' } : method === 'block' ? { header: { hash: params.block_id === MAINNET_GENESIS_HEIGHT ? MAINNET_GENESIS_HASH : nearBlock, height: 100, timestamp_nanosec: '1000000000000' } } : method === 'query' ? { code_hash: over.code ?? pin, block_hash: nearBlock } : {
      final_execution_status: 'FINAL', transaction: { hash: nearHash }, transaction_outcome: { id: nearHash, block_hash: nearBlock, outcome: { executor_id: 'intents.near', receipt_ids: over.orphan ? [] : ['receipt'], logs: [], status: { SuccessReceiptId: 'receipt' } } }, receipts_outcome: over.missing ? [] : [receipt],
    };
    return Response.json({ result });
  }) as typeof fetch;
}
describe('final NEAR USDC evidence', () => {
  const env = { NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH: pin };
  it('checks genesis, rooted receipts, USDC code pin and event recipient', async () => expect(await deliveryVerifier(env, nearFake())('near', 'alice.near', '1000000', [nearHash], 0)).toMatchObject({ state: 'verified', amount: '1000000' }));
  it.each([{ code: 'wrong' }, { chain: 'testnet' }, { orphan: true }, { owner: 'bob.near' }, { status: { Failure: {} } }, { missing: true }])('rejects mismatched NEAR proof %j', async over => expect(await deliveryVerifier(env, nearFake(over))('near', 'alice.near', '1000000', [nearHash], 0)).toMatchObject({ state: 'pending' }));
  it('requires a configured USDC code pin', async () => expect(await deliveryVerifier({}, nearFake())('near', 'alice.near', '1', [nearHash], 0)).toMatchObject({ state: 'pending' }));
});
