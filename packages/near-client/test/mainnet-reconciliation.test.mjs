import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMainnetTransactionCoordinator,verifyMainnetTransactionExecution,MAINNET_GENESIS_HASH} from '../dist/index.js';
const H=n=>'1'.repeat(31)+n,block=H(2),hash=H(3),root=H(4),key='ed25519:11111111111111111111111111111111';
const profile={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'synthetic'};
const expectation={accountId:'alice.near',publicKey:key,receiverId:'bob.near',action:{kind:'transfer',depositYocto:'123'},nonce:'8',minimumNonce:'7',anchorHash:block,anchorHeight:'10000000'};
const out=(id,executor_id,status,receipt_ids=[])=>({id,block_hash:block,outcome:{executor_id,status,receipt_ids,logs:[],gas_burnt:100,tokens_burnt:'1'}});
function transaction(){return {final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash,signer_id:'alice.near',public_key:key,nonce:8,receiver_id:'bob.near',actions:[{Transfer:{deposit:'123'}}]},transaction_outcome:out(hash,'alice.near',{SuccessReceiptId:root},[root]),receipts_outcome:[out(root,'bob.near',{SuccessValue:''})]};}
function rpc(t=transaction(),edit={}){return async(_,init)=>{const r=JSON.parse(init.body);let result;
  if(r.method==='status')result={chain_id:edit.chain??'mainnet',sync_info:{syncing:false}};
  else if(r.method==='block')result={header:{hash:r.params.block_id===9820210?MAINNET_GENESIS_HASH:r.params.block_id??block,height:r.params.block_id===9820210?9820210:10000000,timestamp_nanosec:'100'}};
  else result=t;
  if(edit.unavailable)throw new Error('offline');return Response.json({jsonrpc:'2.0',id:r.id,result});};}
function store(){let raw=null;return {scope:'account-global',read:async()=>raw,compareAndSwap:async(_,old,next)=>{if(raw!==old)return false;raw=next;return true;}};}
const device=crypto.randomUUID();
const coordinator=(s,fetcher=rpc(),deviceId=device)=>createMainnetTransactionCoordinator({store:s,deviceId,profile},fetcher);
test('FINAL exact execution retires reservation and preserves permanent operation tombstone',async()=>{
  const s=store(),c=coordinator(s),a=await c.reserve('a'.repeat(64),expectation);
  await c.handoff(a,hash);const proof=await coordinator(s).reconcile('alice.near');
  assert.equal(proof.kind,'FINAL_EXECUTION');assert.equal(proof.settlement,'NOT_ESTABLISHED');
  assert.equal((await c.read('alice.near')).pending,null);
  await assert.rejects(c.reserve('a'.repeat(64),{...expectation,nonce:'9',minimumNonce:'8'}),/CONSUMED/);
  await assert.rejects(c.reserve('b'.repeat(64),expectation),/STALE_NONCE/);
  await c.reserve('b'.repeat(64),{...expectation,nonce:'9',minimumNonce:'8'});
});
test('20 concurrent tabs admit one reservation; second device has no takeover even after reconciliation',async()=>{
  const s=store(),results=await Promise.allSettled(Array.from({length:20},()=>coordinator(s).reserve('a'.repeat(64),expectation)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const other=coordinator(s,rpc(),crypto.randomUUID());await assert.rejects(other.reserve('b'.repeat(64),expectation),/OTHER_DEVICE/);
  assert.equal((await other.reconcile('alice.near',hash)).kind,'FINAL_EXECUTION');
  await assert.rejects(other.reserve('b'.repeat(64),{...expectation,nonce:'9',minimumNonce:'8'}),/OTHER_DEVICE/);
});
test('crash and lost commit acknowledgement never reopen an account or permit stale handoff',async()=>{
  const s=store(),base=s.compareAndSwap;s.compareAndSwap=async(...args)=>{await base(...args);throw new Error('lost acknowledgement');};
  await assert.rejects(coordinator(s).reserve('a'.repeat(64),expectation));s.compareAndSwap=base;
  await assert.rejects(coordinator(s).reserve('b'.repeat(64),expectation),/UNRESOLVED/);
  const a=(await coordinator(s).read('alice.near')).pending,b=await coordinator(s).handoff(a,hash);
  await assert.rejects(coordinator(s).handoff(a,hash),/STALE/);
  await coordinator(s).uncertain(b,hash);
  assert.equal((await coordinator(s,rpc(transaction(),{unavailable:true})).reconcile('alice.near')).kind,'OUTCOME_UNRESOLVED');
  assert.ok((await coordinator(s).read('alice.near')).pending);
});
test('unknown hash cannot time out into failure; hinted external hash requires exact action/key and newer nonce',async()=>{
  const s=store(),c=coordinator(s),a=await c.reserve('a'.repeat(64),{...expectation,nonce:null});await c.handoff(a,null);
  assert.equal((await c.reconcile('alice.near')).kind,'OUTCOME_UNRESOLVED');
  const t=transaction();t.transaction.nonce=7;
  assert.equal((await coordinator(s,rpc(t)).reconcile('alice.near',hash)).kind,'OUTCOME_UNRESOLVED');
  assert.equal((await c.reconcile('alice.near',hash)).kind,'FINAL_EXECUTION');
});
test('final execution failure is not non-payment or permission to replay a business operation',async()=>{
  const t=transaction();t.status={Failure:{ActionError:{index:0}}};t.receipts_outcome[0].outcome.status=t.status;
  const c=coordinator(store(),rpc(t)),a=await c.reserve('a'.repeat(64),expectation);await c.handoff(a,hash);
  const proof=await c.reconcile('alice.near');assert.equal(proof.execution,'FAILURE');assert.equal(proof.settlement,'NOT_ESTABLISHED');
  await assert.rejects(c.reserve('a'.repeat(64),{...expectation,nonce:'9',minimumNonce:'8'}),/CONSUMED/);
});
test('adversarial finalized responses, nonce/key/action substitution and incomplete graph fail closed',async()=>{
  const mutate=[t=>t.final_execution_status='EXECUTED',t=>t.transaction.public_key='ed25519:wrong',t=>t.transaction.nonce=9,
    t=>t.transaction.receiver_id='mallory.near',t=>t.transaction.actions[0].Transfer.deposit='124',t=>t.transaction.actions.push({DeleteAccount:{beneficiary_id:'mallory.near'}}),
    t=>t.receipts_outcome=[],t=>t.receipts_outcome.push(t.receipts_outcome[0]),t=>t.transaction_outcome.outcome.receipt_ids=[],t=>t.receipts_outcome[0].outcome.status='Unknown'];
  for(const f of mutate){const t=transaction();f(t);assert.equal(await verifyMainnetTransactionExecution(profile,expectation,hash,rpc(t)),null);}
  assert.equal(await verifyMainnetTransactionExecution(profile,expectation,hash,rpc(transaction(),{chain:'testnet'})),null);
});
test('legacy, corrupt or local-only authorities are never silently initialized',async()=>{
  assert.throws(()=>coordinator({...store(),scope:'browser'}),/GLOBAL/);
  await assert.rejects(coordinator({...store(),read:async()=>'{"version":1}'}).reserve('a'.repeat(64),expectation));
});

test('contract execution reconciliation binds exact canonical args, gas, deposit and nonce',async()=>{
  const e={...expectation,receiverId:'token.near',action:{kind:'call',methodName:'ft_transfer',argsJson:'{"amount":"123","receiver_id":"bob.near"}',gas:'30000000000000',depositYocto:'1'}};
  const t=transaction();t.transaction.receiver_id=e.receiverId;t.receipts_outcome[0].outcome.executor_id=e.receiverId;
  t.transaction.actions=[{FunctionCall:{method_name:'ft_transfer',args:Buffer.from(e.action.argsJson).toString('base64'),gas:30000000000000,deposit:'1'}}];
  assert.equal((await verifyMainnetTransactionExecution(profile,e,hash,rpc(t))).kind,'FINAL_EXECUTION');
  for(const mutation of [t=>t.transaction.actions[0].FunctionCall.gas=31000000000000,t=>t.transaction.actions[0].FunctionCall.deposit='2',t=>t.transaction.actions[0].FunctionCall.method_name='ft_transfer_call',
    t=>t.transaction.actions[0].FunctionCall.args=Buffer.from('{"amount":"123","amount":"124","receiver_id":"bob.near"}').toString('base64')]){
    const bad=structuredClone(t);mutation(bad);assert.equal(await verifyMainnetTransactionExecution(profile,e,hash,rpc(bad)),null);
  }
});

test('concurrent reconcilers and lost terminal-write acknowledgement cannot erase replay tombstones',async()=>{
  const s=store(),c=coordinator(s),a=await c.reserve('a'.repeat(64),expectation);await c.handoff(a,hash);
  const results=await Promise.allSettled(Array.from({length:10},()=>coordinator(s).reconcile('alice.near')));
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.kind==='FINAL_EXECUTION').length,1);
  assert.equal((await c.read('alice.near')).completed.length,1);
  await assert.rejects(c.reserve('a'.repeat(64),{...expectation,nonce:'9',minimumNonce:'8'}),/CONSUMED/);
  const s2=store(),c2=coordinator(s2),a2=await c2.reserve('a'.repeat(64),expectation);await c2.handoff(a2,hash);
  const cas=s2.compareAndSwap;s2.compareAndSwap=async(...args)=>{await cas(...args);throw Error('lost final acknowledgement');};
  await assert.rejects(c2.reconcile('alice.near'));s2.compareAndSwap=cas;
  assert.equal((await coordinator(s2).read('alice.near')).completed.length,1);
  await assert.rejects(coordinator(s2).reserve('a'.repeat(64),{...expectation,nonce:'9',minimumNonce:'8'}),/CONSUMED/);
});
