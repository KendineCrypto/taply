import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalJson,MAINNET_USDC,calculateMainnetRequestId,calculateMainnetTermsHash} from '@taply/shared';
import {createMainnetOperationPlanner,mainnetNearConnectParameters,createMainnetWalletBackend,MAINNET_GENESIS_HASH,signMainnetGiftClaim} from '../dist/index.js';
const fixture=n=>JSON.parse(readFileSync(new URL(`./fixtures/mainnet-protocol/${n}.json`,import.meta.url),'utf8'));
const H=n=>'1'.repeat(31)+n,code=H(9),block=H(2),key='ed25519:11111111111111111111111111111111';
const network={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'synthetic'};
const giftConfig={contract:'taply-gift-mainnet',version:'0.2.0-mainnet',network:'near-mainnet',contractId:'gift.fixture.near',testFaultBuild:false,unknownCallbackPolicy:'PENDING_NO_RETRY_NO_ADMIN_OVERRIDE',reviewStatus:'UNREVIEWED_NOT_FOR_REAL_FUNDS',asset:'near:native',giftFeeYocto:'10000000000000000000000',minAmountYocto:'1',maxAmountYocto:'1000000000000000000000000',minLifetimeS:'600',maxLifetimeS:'2592000',maxMessageBytes:280,maxDesign:7,claimDomain:'taply-gift-claim:near-mainnet:v1'};
const profiles={network,usdcCodeHash:code,instant:{...network,contract:{accountId:'devkendinecrypto.near',expectedCodeHash:code}},escrow:{...network,contract:{accountId:'payments.fixture.near',expectedCodeHash:code}},gift:{...network,contract:{accountId:giftConfig.contractId,expectedCodeHash:code,minAmountYocto:giftConfig.minAmountYocto,maxAmountYocto:giftConfig.maxAmountYocto,giftFeeYocto:giftConfig.giftFeeYocto}}};
const snapshot={network:'near-mainnet',accountId:'alice.near',publicKey:key,nonce:'7',blockHash:block,blockHeight:'20000000',blockTimestampNs:'1793520000000000001',amountYocto:'100000000000000000000000000',storageUsageBytes:'100',storageByteCostYocto:'10000000000000000000',gasPriceYocto:'100000000'};
const instantTerms={...fixture('protected-open').terms,contractId:'devkendinecrypto.near',mode:'instant',cancelDurationNs:null};
instantTerms.id=calculateMainnetRequestId({network:instantTerms.network,contractId:instantTerms.contractId,creationNonce:instantTerms.creationNonce,creatorAccountId:instantTerms.creatorAccountId});
const instantState={...fixture('protected-open'),terms:instantTerms,termsHash:calculateMainnetTermsHash(instantTerms)};
const instantConfig={...fixture('token-config'),contractId:'devkendinecrypto.near',contractVersion:'0.6.0-mainnet',routerAccountId:'intents.near',recoveryAccountId:'kendinecrypto.near',protected:{reviewStatus:'UNREVIEWED_OWNER_ACCEPTED_CAPPED'}};
instantConfig.capabilities.protectedPay=false;
const gift={id:'a'.repeat(32),creator:'alice.near',amountYocto:'1',publicKey:'a'.repeat(64),message:'',design:0,createdAtNs:'1',createdHeight:'1',expiresAtNs:'1793520600000000000',status:'AVAILABLE',beneficiary:null,settledAtNs:null,settledHeight:null,payout:null,payoutNonce:null};
function fetcher(options={}){return async(_,init)=>{const r=JSON.parse(init.body),p=r.params;let result;
  if(r.method==='status')result={chain_id:'mainnet',sync_info:{syncing:false}};
  else if(r.method==='block')result={header:{hash:p.block_id===9820210?MAINNET_GENESIS_HASH:block,height:p.block_id===9820210?9820210:20000000,timestamp_nanosec:snapshot.blockTimestampNs}};
  else if(r.method==='gas_price')result={gas_price:snapshot.gasPriceYocto};
  else if(r.method==='EXPERIMENTAL_protocol_config')result={runtime_config:{storage_amount_per_byte:snapshot.storageByteCostYocto}};
  else if(p.request_type==='view_access_key')result={nonce:7,permission:'FullAccess',block_hash:block,block_height:20000000};
  else if(p.request_type==='view_account')result={amount:snapshot.amountYocto,locked:'0',storage_usage:100,code_hash:options.wrongCode?H(8):code,block_hash:block,block_height:20000000};
  else{
    let value;const a=JSON.parse(Buffer.from(p.args_base64,'base64').toString());
    if(p.method_name==='get_config')value=p.account_id===giftConfig.contractId?giftConfig:p.account_id==='payments.fixture.near'?fixture('token-config'):instantConfig;
    else if(p.method_name==='get_request')value=p.account_id==='payments.fixture.near'?(options.request??fixture('protected-open')):instantState;
    else if(p.method_name==='get_gift')value=options.noGift?null:options.gift??gift;
    else if(p.method_name==='quote_create_request')value={quoteVersion:'1',requestId:a.terms.id,termsHash:p.account_id==='payments.fixture.near'?fixture('protected-open').termsHash:instantState.termsHash,storageBytes:'900',depositYocto:'9000000000000000000000',gas:'30000000000000'};
    else if(p.method_name==='ft_balance_of')value=options.lowBalance?'0':'100000000';
    else if(p.method_name==='storage_balance_of')value=options.unregistered?null:{total:'1250000000000000000000',available:'0'};
    else if(p.method_name==='storage_balance_bounds')value={min:'1250000000000000000000',max:null};
    else throw Error('unexpected method '+p.method_name);
    result={result:[...Buffer.from(JSON.stringify(value))],logs:[],block_hash:options.wrongBlock?H(8):block,block_height:20000000};
  }
  return Response.json({jsonrpc:'2.0',id:r.id,result});};}
test('native, USDC, registration and instant policies reconstruct exact allowlisted calls',async()=>{
  const planner=createMainnetOperationPlanner(profiles,fetcher());
  const native=await planner.prepare({kind:'nativeSend',receiverId:'bob.near',amountNear:'0.01',businessId:'a'.repeat(64)},snapshot);
  assert.equal(native.action.depositYocto,'10000000000000000000000');
  const usdc=await planner.prepare({kind:'usdcSend',receiverId:'bob.near',amountBaseUnits:'123',businessId:'a'.repeat(64)},snapshot);
  assert.equal(usdc.receiverId,MAINNET_USDC);assert.equal(usdc.action.depositYocto,'1');assert.equal(usdc.action.argsJson,canonicalJson({receiver_id:'bob.near',amount:'123'}));
  for(const [op,method] of [[{kind:'instantCreate',terms:instantTerms},'create_request'],[{kind:'instantPay',id:instantTerms.id},'pay_instant_native'],[{kind:'instantCancel',id:instantTerms.id},'cancel_unfunded']])assert.equal((await planner.prepare(op,snapshot)).action.methodName,method);
  const registration=await createMainnetOperationPlanner(profiles,fetcher({unregistered:true})).prepare({kind:'registerUsdc'},snapshot);
  assert.equal(registration.action.depositYocto,'1250000000000000000000');
});
test('escrow create/fund/cancel/release/retry follow strict state, consent and cutoff',async()=>{
  const planner=createMainnetOperationPlanner(profiles,fetcher()),open=fixture('protected-open'),locked=fixture('protected-locked');
  assert.equal((await planner.prepare({kind:'escrowCreate',terms:open.terms},snapshot)).action.methodName,'create_request');
  assert.equal((await planner.prepare({kind:'escrowFund',id:open.terms.id,acceptedCancelDurationNs:open.terms.cancelDurationNs},snapshot)).action.depositYocto,open.terms.amountBaseUnits);
  await assert.rejects(planner.prepare({kind:'escrowFund',id:open.terms.id,acceptedCancelDurationNs:'1'},snapshot));
  for(const [name,kind,accountId,time,method] of [['protected-locked','escrowCancel','bob.near',(BigInt(locked.cancelUntilNs)-1n).toString(),'cancel_protected'],['protected-locked','escrowRelease','alice.near',locked.cancelUntilNs,'release_protected'],['protected-refund-failed','escrowRetry','bob.near',locked.cancelUntilNs,'retry_native_transfer']]){
    const request=fixture(name),p=createMainnetOperationPlanner(profiles,fetcher({request}));assert.equal((await p.prepare({kind,id:request.terms.id},{...snapshot,accountId,blockTimestampNs:time})).action.methodName,method);
  }
  await assert.rejects(createMainnetOperationPlanner(profiles,fetcher({request:fixture('protected-refund-in-flight')})).prepare({kind:'escrowRetry',id:open.terms.id},{...snapshot,accountId:'bob.near'}));
});
test('Gift policies require exact owner-approved config and refuse unknown retry',async()=>{
  const create=await createMainnetOperationPlanner(profiles,fetcher({noGift:true})).prepare({kind:'giftCreate',giftId:gift.id,publicKeyHex:gift.publicKey,amountYocto:'1',lifetimeS:600,message:'Gift',design:0},snapshot);
  assert.equal(create.action.depositYocto,'10000000000000000000001');
  const planner=createMainnetOperationPlanner(profiles,fetcher());
  const validGift={...gift,publicKey:'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c'};
  const signatureHex=await signMainnetGiftClaim(crypto,new Uint8Array(32).fill(7),giftConfig.contractId,gift.id,'bob.near');
  assert.equal((await createMainnetOperationPlanner(profiles,fetcher({gift:validGift})).prepare({kind:'giftClaim',giftId:gift.id,signatureHex},{...snapshot,accountId:'bob.near'})).action.methodName,'claim_gift');
  await assert.rejects(planner.prepare({kind:'giftClaim',giftId:gift.id,signatureHex:'b'.repeat(128)},{...snapshot,accountId:'bob.near'}));
  assert.equal((await planner.prepare({kind:'giftRefund',giftId:gift.id},{...snapshot,blockTimestampNs:gift.expiresAtNs})).action.methodName,'refund_gift');
  await assert.rejects(planner.prepare({kind:'giftRetry',giftId:gift.id},snapshot));
  const failed={...gift,status:'CLAIMED',beneficiary:'bob.near',payout:'FAILED',payoutNonce:1,settledAtNs:'100',settledHeight:'10'};
  const retry=nonce=>createMainnetOperationPlanner(profiles,fetcher({gift:{...failed,payoutNonce:nonce}})).prepare({kind:'giftRetry',giftId:gift.id},{...snapshot,accountId:'bob.near'});
  const first=await retry(1),second=await retry(2);assert.deepEqual(first.action,second.action);assert.notEqual(first.operationHash,second.operationHash);
});
test('unanchored data, token code mismatch, missing storage and insufficient token funds cannot become signing reviews',async()=>{
  const op={kind:'usdcSend',receiverId:'bob.near',amountBaseUnits:'123',businessId:'a'.repeat(64)};
  for(const options of [{wrongBlock:true},{wrongCode:true},{unregistered:true},{lowBalance:true}])await assert.rejects(createMainnetOperationPlanner(profiles,fetcher(options)).prepare(op,snapshot));
  await assert.rejects(createMainnetOperationPlanner({...profiles,usdcCodeHash:undefined},fetcher()).prepare(op,snapshot));
  assert.throws(()=>mainnetNearConnectParameters('alice.near','bob.near',{kind:'deleteKey',publicKey:key}));
  const parameters=mainnetNearConnectParameters('alice.near',MAINNET_USDC,{kind:'call',methodName:'ft_transfer',argsJson:canonicalJson({amount:'123',receiver_id:'bob.near'}),gas:'30000000000000',depositYocto:'1'});
  assert.equal(parameters.network,'mainnet');assert.equal(parameters.signerId,'alice.near');assert.equal(parameters.actions.length,1);
});
test('unified wallet gate refuses before confirmation, shared reservation or external wallet invocation',async()=>{
  let writes=0,signs=0,confirms=0;
  const wallet={getAccounts:async()=>[{accountId:'alice.near',publicKey:key}],signAndSendTransaction:async()=>{signs++;throw Error('not allowed');}};
  const backend=createMainnetWalletBackend({profiles,deviceId:crypto.randomUUID(),store:{scope:'account-global',read:async()=>null,compareAndSwap:async()=>{writes++;return true;}},signer:{kind:'near-connect',wallet,accountId:'alice.near',publicKey:key}},fetcher());
  const r=await backend.prepare({kind:'nativeSend',receiverId:'bob.near',amountNear:'0.01',businessId:'a'.repeat(64)});
  assert.equal(r.nonce,null);assert.equal(r.minimumNonce,'7');assert.ok(Object.isFrozen(r));
  await assert.rejects(backend.submit(r.id,async()=>{confirms++;return true;}),/SIGNING_DISABLED/);assert.deepEqual([writes,signs,confirms],[0,0,0]);
});

test('caller profile mutation cannot change a policy instance code pin',async()=>{
  const config=structuredClone(profiles),planner=createMainnetOperationPlanner(config,fetcher({wrongCode:true}));
  config.usdcCodeHash=H(8);
  await assert.rejects(planner.prepare({kind:'usdcSend',receiverId:'bob.near',amountBaseUnits:'1',businessId:'a'.repeat(64)},snapshot),/EVIDENCE/);
});
