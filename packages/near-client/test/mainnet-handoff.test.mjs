import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executeReservedMainnetHandoff} from '../dist/mainnet-handoff.js';
import {createMainnetTransactionCoordinator} from '../dist/index.js';
const key='ed25519:11111111111111111111111111111111',hash='1'.repeat(31)+'2';
const profile={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'inert'};
for(const signer of ['internal','near-connect'])for(const outcome of ['success','rejection','rpc-ambiguity','lost-response','handoff-write-failure','handoff-lost-ack','uncertain-write-failure'])
test(`${signer} handoff ${outcome}: durable fence precedes one send and never authorizes repayment`,async()=>{
  let raw=null,writes=0,sends=0;
  const store={scope:'account-global',read:async()=>raw,compareAndSwap:async(_a,expected,next)=>{
    if(expected!==raw)return false;writes++;
    if(writes===2&&outcome==='handoff-write-failure'||writes===3&&outcome==='uncertain-write-failure')throw Error('REDIS_DOWN');
    raw=next;if(writes===2&&outcome==='handoff-lost-ack')throw Error('ACK_LOST');return true;
  }};
  const deviceId=crypto.randomUUID(),make=()=>createMainnetTransactionCoordinator({store,deviceId,profile},async()=>{throw Error('RPC_UNKNOWN');});
  const authority=make(),expectation={accountId:'alice.near',publicKey:key,receiverId:'bob.near',action:{kind:'transfer',depositYocto:'1'},nonce:signer==='internal'?'8':null,minimumNonce:'7',anchorHash:hash,anchorHeight:'1'};
  const attempt=await authority.reserve('a'.repeat(64),expectation);
  const result=await executeReservedMainnetHandoff(authority,attempt,async()=>({transactionHash:signer==='internal'?hash:null,async send(){
    sends++;assert.equal(JSON.parse(raw).pending.state,'HANDOFF');
    assert.equal(JSON.parse(raw).pending.transactionHash,signer==='internal'?hash:null);
    if(['rejection','rpc-ambiguity','lost-response'].includes(outcome))throw Error(outcome);return hash;
  }}));
  assert.equal(result.kind,'OUTCOME_UNRESOLVED');assert.equal(sends,outcome.startsWith('handoff-')?0:1);
  assert.ok((await make().read('alice.near')).pending);
  await assert.rejects(make().reserve('b'.repeat(64),expectation),/UNRESOLVED/);
});
