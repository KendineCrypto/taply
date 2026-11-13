import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {canonicalJson} from '../../../packages/shared/dist/index.js';
import {MAINNET_GENESIS_HASH,createMainnetOperationPlanner,type MainnetSigningProfiles} from '../../../packages/near-client/dist/index.js';
import {ed25519PublicKeyFromHex} from '../../../packages/near-client/dist/wallet-chain.js';
import {nep413Payload} from '../src/nep413.mts';
import {createAuthenticatedMainnetAuthority,initialMainnetAuthorityState,type MainnetAuthorityCommand} from '../src/mainnet-authenticated-authority.mts';
import {createFencedMainnetRedisPersistence,authorityAnchor,type AuthorityRecord} from '../src/mainnet-authority-persistence.mts';
import {createMainnetAuthorityHttp} from '../src/mainnet-authority-http.mts';
const origin='https://mainnet.taplyapp.xyz',block='1'.repeat(31)+'2';
const profiles:MainnetSigningProfiles={network:{network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'synthetic'}};
function fixture(){
  const keys=generateKeyPairSync('ed25519'),publicKey=ed25519PublicKeyFromHex(keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'));
  let record:AuthorityRecord={epoch:'a'.repeat(64),revision:'0',payload:initialMainnetAuthorityState('alice.near')},time=1000,permission:unknown='FullAccess',rpcCalls=0,fail=false;
  const persistence={read:async()=>{if(fail)throw Error('STORAGE_DOWN');return structuredClone(record);},compareAndSwap:async(old:AuthorityRecord,payload:string)=>{
    if(fail)throw Error('STORAGE_DOWN');if(canonicalJson(old)!==canonicalJson(record))return false;
    record={...record,revision:String(BigInt(record.revision)+1n),payload};return true;}};
  const snapshot={network:'near-mainnet' as const,accountId:'alice.near',publicKey,nonce:'7',blockHash:block,blockHeight:'20000000',blockTimestampNs:'1000000000',
    amountYocto:'100000000000000000000000000',storageUsageBytes:'100',storageByteCostYocto:'10000000000000000000',gasPriceYocto:'100000000'};
  const rpc:typeof fetch=async(_u,init)=>{rpcCalls++;const q=JSON.parse(String(init?.body)),p=q.params;let result;
    if(q.method==='status')result={chain_id:'mainnet',sync_info:{syncing:false}};
    else if(q.method==='block')result={header:{hash:p.block_id===9820210?MAINNET_GENESIS_HASH:block,height:p.block_id===9820210?9820210:20000000,timestamp_nanosec:'1000000000'}};
    else if(q.method==='gas_price')result={gas_price:snapshot.gasPriceYocto};
    else if(q.method==='EXPERIMENTAL_protocol_config')result={runtime_config:{storage_amount_per_byte:snapshot.storageByteCostYocto}};
    else if(p.request_type==='view_account')result={amount:snapshot.amountYocto,locked:'0',storage_usage:100,code_hash:'1'.repeat(31)+'9',block_hash:block,block_height:20000000};
    else if(p.request_type==='view_access_key')result={nonce:7,permission,block_hash:block,block_height:20000000};
    else throw Error('RPC_AMBIGUOUS');return Response.json({jsonrpc:'2.0',id:q.id,result});};
  const make=()=>createAuthenticatedMainnetAuthority({accountId:'alice.near',origin,profiles,persistence},rpc,()=>time),service=make();
  const signed=(c:any)=>({accountId:'alice.near',publicKey,signature:sign(null,createHash('sha256').update(nep413Payload(c.message,c.nonceBase64,c.recipient)).digest(),keys.privateKey).toString('base64')});
  const issue=(c:MainnetAuthorityCommand,device?:string)=>service.challenge(origin,publicKey,c,device);
  const execute=(c:MainnetAuthorityCommand,i:any,s=signed(i.challenge))=>service.execute(origin,i.deviceCredential,i.challenge.id,c,s);
  return {service,make,issue,execute,signed,publicKey,rpc,snapshot,record:()=>record,calls:()=>rpcCalls,
    expire:()=>{time+=120001;},denyKey:()=>{permission={FunctionCall:{receiver_id:'evil.near',method_names:[],allowance:null}};},fail:()=>{fail=true;}};
}
test('NEP-413 actual disposable signature, single-use challenge, durable restart and account/device/command binding',async()=>{
  const f=fixture(),c={method:'read'} as const,i=await f.issue(c);
  await assert.rejects(f.service.execute('https://evil.example',i.deviceCredential,i.challenge.id,c,f.signed(i.challenge)),/ORIGIN/);
  await assert.rejects(f.execute({method:'reconcile'},i),/CHALLENGE/);
  await assert.rejects(f.service.execute(origin,'b'.repeat(43),i.challenge.id,c,f.signed(i.challenge)),/USED/);
  assert.equal(await f.execute(c,i),null);
  await assert.rejects(f.make().execute(origin,i.deviceCredential,i.challenge.id,c,f.signed(i.challenge)),/USED/);
  assert.equal(JSON.parse(f.record().payload).ownerDeviceId,i.challenge.deviceId);
});
test('cross-account, invalid signature, expiry, function-call permission and unavailable storage never authenticate',async()=>{
  for(const attack of ['account','signature','expired','permission','redis']){
    const f=fixture(),c={method:'read'} as const,i=await f.issue(c),s=f.signed(i.challenge);
    if(attack==='account')s.accountId='mallory.near';if(attack==='signature')s.signature=Buffer.alloc(64).toString('base64');
    if(attack==='expired')f.expire();if(attack==='permission')f.denyKey();if(attack==='redis')f.fail();
    await assert.rejects(f.execute(c,i,s));
    if(attack!=='permission')assert.equal(f.calls(),0);
  }
});
test('concurrent replay authenticates once; second enrolled device cannot reserve, even before first reservation',async()=>{
  const f=fixture(),c={method:'read'} as const,i=await f.issue(c);
  const results=await Promise.allSettled(Array.from({length:12},()=>f.execute(c,i)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const operation={kind:'nativeSend' as const,receiverId:'bob.near',amountNear:'0.1',businessId:'b'.repeat(64)};
  const plan=await createMainnetOperationPlanner(profiles,f.rpc).prepare(operation,f.snapshot);
  const expectation={accountId:'alice.near',publicKey:f.publicKey,receiverId:plan.receiverId,action:plan.action,nonce:'8',minimumNonce:'7',anchorHash:block,anchorHeight:'20000000'};
  const reserve:MainnetAuthorityCommand={method:'reserve',args:[plan.operationHash,expectation,operation]};
  const second=await f.issue(reserve);await assert.rejects(f.execute(reserve,second),/OTHER_DEVICE/);
  const owner=await f.issue(reserve,i.deviceCredential),attempt=await f.execute(reserve,owner) as any;
  assert.equal(attempt.state,'RESERVED');
  const again=await f.issue(reserve,i.deviceCredential);await assert.rejects(f.execute(reserve,again),/UNRESOLVED/);
  // Server process restart does not erase a potentially submitted reservation.
  const read=await f.issue(c,i.deviceCredential);
  const ledger=await f.make().execute(origin,read.deviceCredential,read.challenge.id,c,f.signed(read.challenge)) as any;
  assert.equal(ledger.pending.attemptId,attempt.attemptId);
});
test('fenced Redis: rollback, eviction, TTL, lost commit acknowledgement and restart never reset authority',async()=>{
  for(const fault of ['rollback','eviction','ttl','lost-ack','write-failure']){
    const initial={epoch:'c'.repeat(64),revision:'0',payload:initialMainnetAuthorityState('alice.near')};
    let raw:string|null=canonicalJson(initial),head=authorityAnchor('alice.near',initial),ttl=false;
    const witness={read:async()=>structuredClone(head),compareAndSwap:async(_scope:string,old:any,next:any)=>{
      if(canonicalJson(old)!==canonicalJson(head))return false;head=next;return true;}};
    const redis=async(args:readonly string[])=>{
      if(args.length===4)return ttl?null:raw;
      if(fault==='write-failure')throw Error('REDIS_DOWN');
      if(raw!==args[4])return 0;raw=args[5]!;if(fault==='lost-ack')throw Error('LOST_ACK');return 1;};
    const make=()=>createFencedMainnetRedisPersistence(redis,'alice.near',witness),store=make();
    assert.deepEqual(await store.read(),initial);
    if(['lost-ack','write-failure'].includes(fault))await assert.rejects(store.compareAndSwap(initial,'next'));
    else {assert.equal(await store.compareAndSwap(initial,'next'),true);
      if(fault==='rollback')raw=canonicalJson(initial);if(fault==='eviction')raw=null;if(fault==='ttl')ttl=true;}
    if(fault==='lost-ack')assert.equal((await make().read()).payload,'next');
    else await assert.rejects(make().read());
  }
});
test('HTTP adapter rejects origin, oversized bodies and caller identities; limiter precedes all buffering/RPC',async()=>{
  const f=fixture();let rates=0;
  const handler=createMainnetAuthorityHttp(f.service,'alice.near',{consume:async()=>{rates++;}});
  const req=(body:string,site=origin)=>new Request(origin+'/api/mainnet/authority/challenge',{method:'POST',headers:{origin:site,'content-type':'application/json'},body});
  assert.equal((await handler(req('{}','https://evil.example'),'trusted-ip')).status,403);assert.equal(rates,0);
  assert.equal((await handler(req('x'.repeat(65537)),'trusted-ip')).status,503);assert.equal(rates,1);assert.equal(f.calls(),0);
  assert.equal((await handler(req(JSON.stringify({publicKey:f.publicKey,command:{method:'read'},accountId:'mallory.near'})),'trusted-ip')).status,503);
  const response=await handler(req(JSON.stringify({publicKey:f.publicKey,command:{method:'read'}})),'trusted-ip');
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie')!,/Secure; HttpOnly; SameSite=Strict/);
});
