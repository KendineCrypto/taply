import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMainnetWalletAuthority} from '../src/mainnet-wallet-authority.mts';
import {createMainnetOperationPlanner,MAINNET_GENESIS_HASH,type MainnetSigningProfiles,type MainnetWalletSnapshot} from '../../../packages/near-client/dist/index.js';
const block='1'.repeat(31)+'2',key='ed25519:11111111111111111111111111111111';
const profiles:MainnetSigningProfiles={network:{network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'synthetic'}};
const snapshot:MainnetWalletSnapshot={network:'near-mainnet',accountId:'alice.near',publicKey:key,nonce:'7',blockHash:block,blockHeight:'20000000',blockTimestampNs:'100',
  amountYocto:'100000000000000000000000000',storageUsageBytes:'100',storageByteCostYocto:'10000000000000000000',gasPriceYocto:'100000000'};
const rpc:typeof fetch=async(_url,init)=>{
  const q=JSON.parse(String(init?.body)),p=q.params;let result;
  if(q.method==='status')result={chain_id:'mainnet',sync_info:{syncing:false}};
  else if(q.method==='block')result={header:{hash:p.block_id===9820210?MAINNET_GENESIS_HASH:block,height:p.block_id===9820210?9820210:20000000,timestamp_nanosec:'100'}};
  else if(q.method==='gas_price')result={gas_price:snapshot.gasPriceYocto};
  else if(q.method==='EXPERIMENTAL_protocol_config')result={runtime_config:{storage_amount_per_byte:snapshot.storageByteCostYocto}};
  else if(p.request_type==='view_access_key')result={nonce:7,permission:'FullAccess',block_hash:block,block_height:20000000};
  else if(p.request_type==='view_account')result={amount:snapshot.amountYocto,locked:'0',storage_usage:100,code_hash:'1'.repeat(31)+'9',block_hash:block,block_height:20000000};
  else throw Error('No terminal transaction evidence in this fixture');
  return Response.json({jsonrpc:'2.0',id:q.id,result});
};
test('server semantic authority reconstructs actions and nonce; never accepts client terminal proof or cross-account state',async()=>{
  let raw:string|null=null,writes=0;
  const store={scope:'account-global' as const,read:async()=>raw,compareAndSwap:async(_id:string,expected:string|null,next:string)=>{if(raw!==expected)return false;raw=next;writes++;return true;}};
  const principal={accountId:'alice.near',publicKey:key,deviceId:crypto.randomUUID()};
  const authority=createMainnetWalletAuthority({principal,profiles,store},rpc);
  const operation={kind:'nativeSend' as const,receiverId:'bob.near',amountNear:'0.1',businessId:'a'.repeat(64)};
  const plan=await createMainnetOperationPlanner(profiles,rpc).prepare(operation,snapshot);
  const expectation={accountId:principal.accountId,publicKey:key,receiverId:plan.receiverId,action:plan.action,nonce:'8',minimumNonce:'7',anchorHash:block,anchorHeight:'20000000'};
  for(const patch of [{accountId:'mallory.near'},{publicKey:'ed25519:wrong'},{nonce:'9'},{receiverId:'mallory.near'},{action:{kind:'transfer' as const,depositYocto:'1'}}])
    await assert.rejects(authority.reserve(plan.operationHash,{...expectation,...patch},operation));
  assert.equal(writes,0);
  const attempt=await authority.reserve(plan.operationHash,expectation,operation);await authority.handoff(attempt,null);
  assert.equal((await authority.reconcile(principal.accountId)).kind,'OUTCOME_UNRESOLVED');
  await assert.rejects(authority.read('mallory.near'),/UNAUTHORIZED/);
  await assert.rejects(authority.reserve(plan.operationHash,expectation,operation),/UNRESOLVED/);
  assert.equal('compareAndSwap' in authority,false);assert.equal('clear' in authority,false);
});
