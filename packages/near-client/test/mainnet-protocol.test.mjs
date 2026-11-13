import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {MainnetEscrowRequestSchema,calculateMainnetEscrowTermsHash} from '@taply/shared';
import {MainnetEscrowConfigSchema,prepareMainnetFundProtectedNative,prepareMainnetCancelProtected,prepareMainnetReleaseProtected,
  prepareMainnetRetryProtectedTransfer,prepareMainnetProtectedTokenFunding,createMainnetWalletChain,
  MainnetGiftConfigSchema,prepareMainnetCreateGift,prepareMainnetGiftSettlement,signMainnetGiftClaim,
  verifyMainnetDirectTransfer,MAINNET_GENESIS_HASH} from '../dist/index.js';
const dir=new URL('./fixtures/mainnet-protocol/',import.meta.url);
const fixture=name=>JSON.parse(readFileSync(new URL(name+'.json',dir),'utf8'));
const config=fixture('token-config');
const giftConfig={contract:'taply-gift-mainnet',version:'0.2.0-mainnet',network:'near-mainnet',contractId:'gift.fixture.near',testFaultBuild:false,
  unknownCallbackPolicy:'PENDING_NO_RETRY_NO_ADMIN_OVERRIDE',reviewStatus:'UNREVIEWED_NOT_FOR_REAL_FUNDS',asset:'near:native',giftFeeYocto:'10000000000000000000000',
  minAmountYocto:'10000000000000000000000',maxAmountYocto:'2000000000000000000000000',minLifetimeS:'600',maxLifetimeS:'2592000',maxMessageBytes:280,maxDesign:7,
  claimDomain:'taply-gift-claim:near-mainnet:v1'};
test('Rust-generated Mainnet escrow configurations and every emitted state pass independent wire validation',()=>{
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.json'))){
    const value=fixture(name.replace('.json',''));
    if(name.includes('config')) MainnetEscrowConfigSchema.parse(value);
    else { MainnetEscrowRequestSchema.parse(value); assert.equal(calculateMainnetEscrowTermsHash(value.terms),value.termsHash); }
  }
});
test('Mainnet escrow builders enforce consent, exact principal, cutoff, beneficiary and recorded failure',()=>{
  const open=fixture('protected-open'),locked=fixture('protected-locked');
  const input={config,contractId:config.contractId,request:open,signerAccountId:'bob.near',observedAtNs:open.createdAtNs,acceptedCancelDurationNs:open.terms.cancelDurationNs};
  assert.equal(prepareMainnetFundProtectedNative(input).depositYocto,open.terms.amountBaseUnits);
  assert.throws(()=>prepareMainnetFundProtectedNative({...input,acceptedCancelDurationNs:'1'}));
  assert.throws(()=>prepareMainnetFundProtectedNative({...input,signerAccountId:'bob.testnet'}));
  assert.throws(()=>prepareMainnetFundProtectedNative({...input,config:{...config,network:'near-testnet'}}));
  assert.throws(()=>prepareMainnetFundProtectedNative({...input,config:{...config,gas:{...config.gas,fundProtectedNative:'1'}}}));
  const cancel={...input,request:locked,observedAtNs:(BigInt(locked.cancelUntilNs)-1n).toString()};
  assert.equal(prepareMainnetCancelProtected(cancel).depositYocto,'1');
  assert.throws(()=>prepareMainnetCancelProtected({...cancel,signerAccountId:'alice.near'}));
  assert.throws(()=>prepareMainnetReleaseProtected(cancel));
  assert.throws(()=>prepareMainnetCancelProtected({...cancel,observedAtNs:locked.cancelUntilNs}));
  assert.equal(prepareMainnetReleaseProtected({...cancel,observedAtNs:locked.cancelUntilNs}).methodName,'release_protected');
  for(const name of ['protected-refund-in-flight','protected-release-in-flight','protected-final-paid','protected-cancelled-refunded'])
    assert.throws(()=>prepareMainnetRetryProtectedTransfer({...input,request:fixture(name)}));
  assert.equal(prepareMainnetRetryProtectedTransfer({...input,request:fixture('protected-refund-failed')}).methodName,'retry_native_transfer');
  const token=fixture('token-protected-locked');
  const tokenOpen={...open,terms:token.terms,termsHash:token.termsHash};
  assert.equal(JSON.parse(prepareMainnetProtectedTokenFunding({...input,request:tokenOpen}).args.msg).action,'fund_protected');
  assert.throws(()=>prepareMainnetProtectedTokenFunding({...input,request:tokenOpen,signerAccountId:'intents.near'}));
});
test('Mainnet Gift uses explicit policy and cross-language network-bound link-key vector',async()=>{
  MainnetGiftConfigSchema.parse(giftConfig);
  const id='0123456789abcdef0123456789abcdef';
  const signature=await signMainnetGiftClaim(crypto,new Uint8Array(32).fill(7),'gift.fixture.near',id,'bob.near');
  assert.equal(signature,'f785fc6e9542641187fd9a1717a018637af8252a6e6e74dbcc16388a6616c42ad61aba14f66e87c6c80fb96288ae1053cdf8cec0253c4ade689033a1e1c42e05');
  await assert.rejects(signMainnetGiftClaim(crypto,new Uint8Array(32),'gift.fixture.near',id,'bob.testnet'));
  const input={config:giftConfig,signerAccountId:'alice.near',giftId:id,publicKeyHex:'a'.repeat(64),amountYocto:'1000000000000000000000000',lifetimeS:600,message:'Hediye 🎁',design:1};
  assert.equal(prepareMainnetCreateGift(input).depositYocto,'1010000000000000000000000');
  for(const config of [{...giftConfig,network:'near-testnet'},{...giftConfig,contractId:'devkendinecrypto.near'},{...giftConfig,maxAmountYocto:'1'},{...giftConfig,testFaultBuild:true}])
    assert.throws(()=>prepareMainnetCreateGift({...input,config}));
  const gift={id,creator:'alice.near',amountYocto:input.amountYocto,publicKey:input.publicKeyHex,message:'',design:1,createdAtNs:'1',createdHeight:'1',expiresAtNs:'600000000001',status:'AVAILABLE',beneficiary:null,settledAtNs:null,settledHeight:null,payout:null,payoutNonce:null};
  const claim={config:giftConfig,gift,signerAccountId:'bob.near',observedAtNs:'2',action:'claim',signatureHex:signature};
  assert.equal(prepareMainnetGiftSettlement(claim).methodName,'claim_gift');
  assert.throws(()=>prepareMainnetGiftSettlement({...claim,observedAtNs:gift.expiresAtNs}));
  assert.equal(prepareMainnetGiftSettlement({...claim,action:'refund',signerAccountId:'alice.near',observedAtNs:gift.expiresAtNs}).methodName,'refund_gift');
  assert.throws(()=>prepareMainnetGiftSettlement({...claim,action:'retry',gift:{...gift,status:'CLAIMED',beneficiary:'bob.near',settledAtNs:'2',settledHeight:'2',payout:'PENDING',payoutNonce:1}}));
});
const hash='11111111111111111111111111111112',receiptHash='11111111111111111111111111111113';
const profile={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'fixture'};
const tx={final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash,signer_id:'alice.near',receiver_id:'bob.near',actions:[{Transfer:{deposit:'1'}}]},
  transaction_outcome:{id:hash,block_hash:hash,outcome:{executor_id:'alice.near',status:{SuccessReceiptId:receiptHash},receipt_ids:[receiptHash]}},
  receipts_outcome:[{id:receiptHash,block_hash:hash,outcome:{executor_id:'bob.near',status:{SuccessValue:''},receipt_ids:[]}}]};
function mock(change={}){return async(_,init)=>{const r=JSON.parse(init.body);let result;
  if(r.method==='status')result={chain_id:change.chain??'mainnet',sync_info:{syncing:false}};
  else if(r.method==='block')result={header:{hash:r.params.block_id===9820210?MAINNET_GENESIS_HASH:hash,height:r.params.block_id===9820210?9820210:200000000,timestamp_nanosec:'1000'}};
  else if(r.method==='EXPERIMENTAL_tx_status')result=change.tx??tx;
  else if(r.method==='gas_price')result={gas_price:'100000000'};
  else if(r.method==='EXPERIMENTAL_protocol_config')result={runtime_config:{storage_amount_per_byte:'10000000000000000000'}};
  else if(r.params.request_type==='view_access_key') result={nonce:0,permission:change.permission??'FullAccess',block_hash:change.keyBlock??hash,block_height:200000000};
  else result={amount:'1000000000000000000000000',locked:'0',storage_usage:100,code_hash:hash,block_hash:hash,block_height:200000000};
  return Response.json({jsonrpc:'2.0',id:r.id,result});};}
test('activation proves exact FullAccess key and anchor; wrong network/key never becomes activated',async()=>{
  const key='ed25519:11111111111111111111111111111111';
  assert.equal((await createMainnetWalletChain(profile,mock()).snapshot('alice.near',key)).network,'near-mainnet');
  for(const change of [{chain:'testnet'},{permission:{FunctionCall:{}}},{keyBlock:receiptHash}])
    await assert.rejects(createMainnetWalletChain(profile,mock(change)).snapshot('alice.near',key));
});
test('personal Gift verifier rejects fake success, wrong action/amount, disconnected or duplicate receipts and wrong network',async()=>{
  const ref={txHash:hash,from:'alice.near',to:'bob.near',amountYocto:'1'};
  assert.equal((await verifyMainnetDirectTransfer(profile,ref,mock())).kind,'VERIFIED');
  const mutations=[t=>t.status={Failure:{}},t=>t.final_execution_status='EXECUTED',t=>t.transaction.actions[0].Transfer.deposit='2',
    t=>t.transaction.actions.push({Transfer:{deposit:'1'}}),t=>t.transaction_outcome.outcome.receipt_ids=[],
    t=>t.receipts_outcome.push(t.receipts_outcome[0]),t=>t.receipts_outcome[0].outcome.executor_id='mallory.near',
    t=>t.receipts_outcome[0].outcome.status={Failure:{}},t=>t.transaction.receiver_id='mallory.near'];
  for(const mutate of mutations){const changed=structuredClone(tx);mutate(changed);assert.equal((await verifyMainnetDirectTransfer(profile,ref,mock({tx:changed}))).kind,'NOT_VERIFIED');}
  assert.equal((await verifyMainnetDirectTransfer(profile,ref,mock({chain:'testnet'}))).kind,'NOT_VERIFIED');
});
