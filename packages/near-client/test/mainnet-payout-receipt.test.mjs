import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateMainnetRequestId,calculateMainnetTermsHash,MAINNET_USDC,MAINNET_USDC_ASSET} from '@taply/shared';
import {MAINNET_GENESIS_HASH,signMainnetGiftClaim,verifyMainnetGiftSettlement} from '../dist/index.js';
import {baseEncode} from 'near-api-js';
import {verifyMainnetNativePayment,verifyMainnetGiftReceipt} from '../dist/mainnet-payout-receipt.js';
const H=n=>'1'.repeat(31)+String(n),code=H(9),bh=H(2),txHash=H(3),root=H(4),transfer=H(5),callback=H(6),dataId=H(7);
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64');
const fc=(method_name,parameters,deposit)=>({FunctionCall:{method_name,args:b64(parameters),deposit,gas:50000000000000}});
const outcome=(id,executor_id,status,receipt_ids=[])=>({id,block_hash:bh,outcome:{executor_id,status,receipt_ids,logs:[],gas_burnt:100,tokens_burnt:'10'}});
async function fixture(gift=false){
  const contract=gift?'gift.fixture.near':'devkendinecrypto.near',signer='payer.near',beneficiary=gift?signer:'merchant.near';
  const profile={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'synthetic',contract:{accountId:contract,expectedCodeHash:code}};
  const terms={schemaVersion:'taply.intent.v1',network:'near-mainnet',contractId:contract,creatorAccountId:beneficiary,creationNonce:'a'.repeat(64),
    assetId:'near:native',amountBaseUnits:'1',mode:'instant',cancelDurationNs:null,fundingExpiresAtNs:'9999',permittedPayerAccountId:null,merchantAccountId:null,memo:'',sessionBinding:null};
  let state,config,call,cb,ref;
  if(gift){
    Object.assign(profile.contract,{minAmountYocto:'1',maxAmountYocto:'2',giftFeeYocto:'10000000000000000000000'});
    config={contract:'taply-gift-mainnet',version:'0.2.0-mainnet',network:'near-mainnet',contractId:contract,testFaultBuild:false,
      unknownCallbackPolicy:'PENDING_NO_RETRY_NO_ADMIN_OVERRIDE',reviewStatus:'UNREVIEWED_NOT_FOR_REAL_FUNDS',asset:'near:native',
      minAmountYocto:'1',maxAmountYocto:'2',giftFeeYocto:profile.contract.giftFeeYocto,minLifetimeS:'600',maxLifetimeS:'2592000',maxMessageBytes:280,maxDesign:7,
      claimDomain:'taply-gift-claim:near-mainnet:v1'};
    const id='a'.repeat(32),signature=await signMainnetGiftClaim(crypto,new Uint8Array(32).fill(7),contract,id,signer);
    state={id,creator:'merchant.near',amountYocto:'1',publicKey:'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c',message:'',design:0,
      createdAtNs:'1',createdHeight:'1',expiresAtNs:'9999',status:'CLAIMED',beneficiary,settledAtNs:'100',settledHeight:'10000000',payout:'CONFIRMED',payoutNonce:1};
    call=fc('claim_gift',{gift_id:id,signature},'0');cb=fc('on_payout',{gift_id:id,nonce:1},'0');ref={giftId:id,txHash,signerAccountId:signer};
  }else{
    terms.id=calculateMainnetRequestId({network:terms.network,contractId:contract,creatorAccountId:beneficiary,creationNonce:terms.creationNonce});
    const hash=calculateMainnetTermsHash(terms);
    state={terms,termsHash:hash,sessionCommitment:null,recipientAccountId:beneficiary,status:'FINAL_PAID',revision:'3',createdAtNs:'1',payerAccountId:signer,
      fundedAtNs:'100',cancelUntilNs:null,settlementBranch:'RECIPIENT',latestOperation:{nonce:'1',kind:'INSTANT_PAYOUT',destinationAccountId:beneficiary,amountBaseUnits:'1',status:'SUCCEEDED',startedAtNs:'100',resolvedAtNs:'100',failureCode:null}};
    config={schemaVersion:'taply.contract-config.v1',contractVersion:'0.6.0-mainnet',network:'near-mainnet',contractId:contract,routerAccountId:'intents.near',recoveryAccountId:'kendinecrypto.near',
      nativeCapYocto:'1000000000000000000000000',usdcCapBaseUnits:'25000000',testFaultBuild:false,unknownCallbackPolicy:'IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE',
      capabilities:{instantNative:true,nep141:true,protectedPay:false,intentsRouter:false},tokens:[{accountId:MAINNET_USDC,assetId:MAINNET_USDC_ASSET,decimals:6,symbol:'USDC'}],
      protected:{reviewStatus:'UNREVIEWED_OWNER_ACCEPTED_CAPPED'},gas:{createRequest:'30000000000000',payInstantNative:'50000000000000',callback:'15000000000000',ftTransfer:'15000000000000',ftOnTransfer:'40000000000000'}};
    call=fc('pay_instant_native',{id:terms.id,expectedTermsHash:hash},'1');cb=fc('on_native_transfer_complete',{id:terms.id,operationNonce:'1',kind:'INSTANT_PAYOUT'},'0');ref={id:terms.id,txHash,signerAccountId:signer};
  }
  const receipt=(id,predecessor_id,receiver_id,action,input_data_ids=[],output_data_receivers=[])=>({receipt_id:id,predecessor_id,receiver_id,receipt:{Action:{signer_id:signer,actions:[action],input_data_ids,output_data_receivers}}});
  const tx={final_execution_status:'FINAL',status:{SuccessValue:gift?'':'dHJ1ZQ=='},transaction:{hash:txHash,signer_id:signer,receiver_id:contract,actions:[call]},
    transaction_outcome:outcome(txHash,signer,{SuccessReceiptId:root},[root]),receipts_outcome:[outcome(root,contract,gift?{SuccessValue:''}:{SuccessReceiptId:callback},[transfer,callback]),
      outcome(transfer,beneficiary,{SuccessValue:''}),outcome(callback,contract,{SuccessValue:'dHJ1ZQ=='})],
    receipts:[receipt(root,signer,contract,call),receipt(transfer,contract,beneficiary,{Transfer:{deposit:'1'}},[],[{data_id:dataId,receiver_id:contract}]),receipt(callback,contract,contract,cb,[dataId])]};
  return {gift,profile,ref,config,state,tx};
}
function fetcher(f,edit={}){return async(_,init)=>{const r=JSON.parse(init.body);let result;
  if(r.method==='status')result={chain_id:'mainnet',sync_info:{syncing:false}};
  else if(r.method==='block')result={header:{hash:r.params.block_id===9820210?MAINNET_GENESIS_HASH:r.params.block_id??bh,prev_hash:H(8),height:r.params.block_id===9820210?9820210:10000000,timestamp_nanosec:'100'}};
  else if(r.method==='EXPERIMENTAL_tx_status')result=f.graphs?.get(r.params.tx_hash)??f.tx;
  else if(r.params.request_type==='view_account')result={amount:'10000000000000000000000000',locked:'0',storage_usage:1000,code_hash:edit.code??code,block_hash:r.params.block_id,block_height:10000000};
  else if(r.params.request_type==='view_access_key_list')result={block_hash:r.params.block_id,keys:[{public_key:'ed25519:fixture',access_key:{nonce:edit.keyActivity&&r.params.block_id===bh?1:0,permission:'FullAccess'}}]};
  else result={result:[...Buffer.from(JSON.stringify(r.params.method_name==='get_config'?f.config:f.state))],logs:[],block_hash:bh,block_height:10000000};
  return Response.json({jsonrpc:'2.0',id:r.id,result});};}
const verify=f=>(f.gift?verifyMainnetGiftReceipt:verifyMainnetNativePayment);
for(const gift of [false,true])test(`${gift?'Gift':'native instant'} payout requires complete exact transfer, callback dependency and unchanged deployment authority`,async()=>{
  const f=await fixture(gift);assert.equal((await verify(f)(f.profile,f.ref,fetcher(f))).kind,'VERIFIED');
  for(const edit of [{code:H(8)},{keyActivity:true}]) assert.equal((await verify(f)(f.profile,f.ref,fetcher(f,edit))).kind,'NOT_VERIFIED');
  const mutations=[x=>x.tx.receipts_outcome[1].outcome.status={Failure:{ActionError:'fixture'}},x=>x.tx.receipts_outcome[2].outcome.status={Failure:{ActionError:'fixture'}},
    x=>x.tx.receipts[1].receipt.Action.actions[0].Transfer.deposit='2',x=>x.tx.receipts[1].receiver_id='mallory.near',
    x=>x.tx.receipts[2].receipt.Action.input_data_ids=[H(8)],x=>x.tx.receipts[2].predecessor_id='mallory.near',
    x=>x.tx.receipts_outcome.push(x.tx.receipts_outcome[1]),x=>x.tx.receipts.pop(),x=>x.tx.receipts_outcome[0].outcome.receipt_ids=[transfer],
    x=>x.tx.receipts[2].receipt.Action.actions[0].FunctionCall.args=b64({id:'wrong',nonce:1}),
    x=>x.tx.final_execution_status='EXECUTED',x=>x.tx.transaction.actions[0].FunctionCall.deposit='999'];
  for(const mutate of mutations){const x=structuredClone(f);mutate(x);assert.equal((await verify(x)(x.profile,x.ref,fetcher(x))).kind,'NOT_VERIFIED');}
  const unknown=structuredClone(f);if(gift)unknown.state.payout='PENDING';else {unknown.state.status='PAYOUT_IN_FLIGHT';unknown.state.latestOperation.status='IN_FLIGHT';unknown.state.latestOperation.resolvedAtNs=null;}
  assert.equal((await verify(unknown)(unknown.profile,unknown.ref,fetcher(unknown))).kind,'NOT_VERIFIED');
});

for(const refund of [false,true])for(const retry of [false,true])test(`Gift independent history refund=${refund} retry=${retry}`,async()=>{
  const f=await fixture(true),first=f.tx;
  if(refund){
    f.state.creator=f.state.beneficiary;f.state.status='REFUNDED';f.state.expiresAtNs='99';
    first.transaction.actions=[fc('refund_gift',{gift_id:f.state.id},'0')];
    first.receipts[0].receipt.Action.actions=first.transaction.actions;
  }
  f.graphs=new Map([[txHash,first]]);
  const ref={giftId:f.state.id,operations:[{transactionHash:txHash,signerAccountId:f.ref.signerAccountId}]};
  if(retry){
    f.state.payoutNonce=2;const next=structuredClone(first);
    const mapped=new Map([txHash,root,transfer,callback,dataId].map((id,i)=>[id,baseEncode(new Uint8Array(32).fill(30+i))]));
    const rewrite=v=>typeof v==='string'?(mapped.get(v)??v):Array.isArray(v)?v.map(rewrite):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x)])):v;
    const second=rewrite(next);second.transaction.actions=[fc('retry_payout',{gift_id:f.state.id},'0')];second.receipts[0].receipt.Action.actions=second.transaction.actions;
    second.receipts[2].receipt.Action.actions=[fc('on_payout',{gift_id:f.state.id,nonce:2},'0')];
    first.receipts_outcome[1].outcome.status={Failure:{ActionError:{index:0}}};first.receipts_outcome[2].outcome.status={SuccessValue:b64(false)};
    f.graphs.set(second.transaction.hash,second);ref.operations.push({transactionHash:second.transaction.hash,signerAccountId:f.ref.signerAccountId});
  }
  assert.equal((await verifyMainnetGiftSettlement(f.profile,ref,fetcher(f))).kind,'VERIFIED_GIFT_SETTLEMENT');
  if(retry){
    assert.equal((await verifyMainnetGiftSettlement(f.profile,{...ref,operations:ref.operations.slice(1)},fetcher(f))).kind,'NOT_VERIFIED');
    const bad=structuredClone(f);bad.graphs.get(txHash).receipts_outcome[1].outcome.status={SuccessValue:''};
    assert.equal((await verifyMainnetGiftSettlement(bad.profile,ref,fetcher(bad))).kind,'NOT_VERIFIED');
  }
  if(!refund){const bad=structuredClone(f),a={gift_id:f.state.id,signature:'0'.repeat(128)};bad.graphs.get(txHash).transaction.actions=[fc('claim_gift',a,'0')];bad.graphs.get(txHash).receipts[0].receipt.Action.actions=[fc('claim_gift',a,'0')];
    assert.equal((await verifyMainnetGiftSettlement(bad.profile,ref,fetcher(bad))).kind,'NOT_VERIFIED');}
});
