import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {baseEncode} from 'near-api-js';
import {MAINNET_USDC,MAINNET_USDC_ASSET,calculateMainnetRequestId,calculateMainnetTermsHash,calculateMainnetEscrowRequestId,calculateMainnetEscrowTermsHash} from '@taply/shared';
import {verifyMainnetSettlement,MAINNET_GENESIS_HASH} from '../dist/index.js';
const H=n=>baseEncode(new Uint8Array(32).fill(n)),code=H(9),tokenCode=H(10),block=H(2),key='ed25519:fixture';
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64');
const fc=(method_name,args,deposit='0')=>({FunctionCall:{method_name,args:b64(args),gas:50000000000000,deposit}});
const out=(id,executor_id,status,receipt_ids=[])=>({id,block_hash:block,outcome:{executor_id,status,receipt_ids,logs:[],gas_burnt:100,tokens_burnt:'1'}});
const payload=(id,predecessor_id,receiver_id,signer,action,inputs=[],outputs=[])=>({receipt_id:id,predecessor_id,receiver_id,receipt:{Action:{signer_id:signer,actions:[action],input_data_ids:inputs,output_data_receivers:outputs}}});
const fixture=n=>JSON.parse(readFileSync(new URL(`./fixtures/mainnet-protocol/${n}.json`,import.meta.url),'utf8'));
function scenario({token=false,protectedPay=false,refund=false,retry=false,router=false}={}){
  const contract=protectedPay?'payments.fixture.near':'devkendinecrypto.near',payer=router?'intents.near':'bob.near',recipient='alice.near',beneficiary=refund?payer:recipient;
  const terms={...fixture('protected-open').terms,contractId:contract,creatorAccountId:recipient,creationNonce:'a'.repeat(64),amountBaseUnits:token?'123':'1',assetId:token?MAINNET_USDC_ASSET:'near:native',mode:protectedPay?'protected':'instant',cancelDurationNs:protectedPay?'60000000000':null};
  terms.id=(protectedPay?calculateMainnetEscrowRequestId:calculateMainnetRequestId)({network:'near-mainnet',contractId:contract,creatorAccountId:recipient,creationNonce:terms.creationNonce});
  const termsHash=(protectedPay?calculateMainnetEscrowTermsHash:calculateMainnetTermsHash)(terms),kind=protectedPay?refund?'PROTECTED_REFUND':'PROTECTED_RELEASE':'INSTANT_PAYOUT';
  const time='1793520000000000000',cutoff=(BigInt(time)+60000000000n).toString();
  const profile={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'synthetic',contract:{accountId:contract,expectedCodeHash:code}};
  const config=protectedPay?fixture('token-config'):{...fixture('token-config'),contractId:contract,contractVersion:'0.6.0-mainnet',routerAccountId:'intents.near',recoveryAccountId:'kendinecrypto.near',protected:{reviewStatus:'UNREVIEWED_OWNER_ACCEPTED_CAPPED'}};
  if(!protectedPay)config.capabilities.protectedPay=false;
  const when=protectedPay&&!refund?cutoff:time;
  const state={terms,termsHash,sessionCommitment:null,recipientAccountId:recipient,status:refund?'CANCELLED_REFUNDED':'FINAL_PAID',revision:'5',createdAtNs:time,payerAccountId:payer,fundedAtNs:time,cancelUntilNs:protectedPay?cutoff:null,settlementBranch:refund?'PAYER':'RECIPIENT',latestOperation:{nonce:retry?'2':'1',kind,destinationAccountId:beneficiary,amountBaseUnits:terms.amountBaseUnits,status:'SUCCEEDED',startedAtNs:when,resolvedAtNs:when,failureCode:null}};
  const graphs=new Map(),times=new Map();let serial=20;
  function graph(signer,receiver,action,timestamp){
    const hash=H(serial++),root=H(serial++),t={final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash,signer_id:signer,receiver_id:receiver,actions:[action]},transaction_outcome:out(hash,signer,{SuccessReceiptId:root},[root]),receipts_outcome:[out(root,receiver,{SuccessValue:''})],receipts:[payload(root,signer,receiver,signer,action)]};
    // Each transaction gets a separate block; timestamp equality across blocks is legal.
    const bh=H(serial++);times.set(bh,timestamp);t.transaction_outcome.block_hash=bh;t.receipts_outcome[0].block_hash=bh;
    graphs.set(hash,t);return {t,bh,root,signer,reference:{transactionHash:hash,signerAccountId:signer},add(id,predecessor,receiver,action,status,children=[],inputs=[],outputs=[]){t.receipts.push(payload(id,predecessor,receiver,signer,action,inputs,outputs));const o=out(id,receiver,status,children);o.block_hash=bh;t.receipts_outcome.push(o);}};
  }
  function payout(g,source,nonce,success){
    const paid=H(serial++),cb=H(serial++),data=H(serial++),sourceNode=g.t.receipts_outcome.find(x=>x.id===source);
    sourceNode.outcome.receipt_ids.push(paid,cb);
    g.add(paid,contract,token?MAINNET_USDC:beneficiary,token?fc('ft_transfer',{receiver_id:beneficiary,amount:terms.amountBaseUnits,memo:'Taply settlement'},'1'):{Transfer:{deposit:terms.amountBaseUnits}},success?{SuccessValue:''}:{Failure:{ActionError:{index:0}}},[],[],[{data_id:data,receiver_id:contract}]);
    g.add(cb,contract,contract,fc('on_native_transfer_complete',{id:terms.id,operationNonce:String(nonce),kind}),{SuccessValue:b64(success)},[],[data]);
    return cb;
  }
  const msg=JSON.stringify(protectedPay?{id:terms.id,expectedTermsHash:termsHash,action:'fund_protected',acceptedCancelDurationNs:terms.cancelDurationNs,consentVersion:'taply.protected-consent.v1'}:{id:terms.id,expectedTermsHash:termsHash,action:'pay_instant'});
  const amount=router?'125':terms.amountBaseUnits;
  let fund,source;
  if(token){
    const tokenCall=fc('ft_transfer_call',{receiver_id:contract,amount,msg},'1');
    fund=graph(router?'relayer.near':payer,router?'intents.near':MAINNET_USDC,router?fc('execute',{}):tokenCall,time);
    let parent=fund.root;if(router){parent=H(serial++);fund.t.receipts_outcome[0].outcome.receipt_ids=[parent];fund.t.receipts_outcome[0].outcome.status={SuccessReceiptId:parent};fund.add(parent,payer,MAINNET_USDC,tokenCall,{SuccessValue:''});}
    source=H(serial++);const resolver=H(serial++),data=H(serial++);
    const parentNode=fund.t.receipts_outcome.find(x=>x.id===parent);parentNode.outcome.receipt_ids=[source,resolver];parentNode.outcome.status={SuccessReceiptId:resolver};
    fund.add(source,MAINNET_USDC,contract,fc('ft_on_transfer',{sender_id:payer,amount,msg}),{SuccessValue:b64('0')},[],[],[{data_id:data,receiver_id:MAINNET_USDC}]);
    fund.add(resolver,MAINNET_USDC,MAINNET_USDC,fc('ft_resolve_transfer',{sender_id:payer,receiver_id:contract,amount}),{SuccessValue:b64(amount)},[],[data]);
    fund.t.status={SuccessValue:b64(amount)};
  }else{
    fund=graph(payer,contract,fc(protectedPay?'fund_protected_native':'pay_instant_native',protectedPay?{id:terms.id,expectedTermsHash:termsHash,acceptedCancelDurationNs:terms.cancelDurationNs,consentVersion:'taply.protected-consent.v1'}:{id:terms.id,expectedTermsHash:termsHash},terms.amountBaseUnits),time);source=fund.root;
  }
  const operations=[];
  if(!protectedPay){const cb=payout(fund,source,1,!retry);if(!token){fund.t.receipts_outcome[0].outcome.status={SuccessReceiptId:cb};fund.t.status={SuccessValue:b64(!retry)};}operations.push(fund.reference);}
  else{
    const g=graph(refund?payer:'caller.near',contract,fc(refund?'cancel_protected':'release_protected',refund?{id:terms.id,expectedTermsHash:termsHash}:{id:terms.id},'1'),when);
    const cb=payout(g,g.root,1,!retry);g.t.receipts_outcome[0].outcome.status={SuccessReceiptId:cb};g.t.status={SuccessValue:b64(!retry)};operations.push(g.reference);
  }
  if(retry){const g=graph(beneficiary,contract,fc('retry_native_transfer',{id:terms.id,expectedOperationNonce:'1'},'1'),when);const cb=payout(g,g.root,2,true);g.t.receipts_outcome[0].outcome.status={SuccessReceiptId:cb};g.t.status={SuccessValue:b64(true)};operations.push(g.reference);}
  return {input:{kind:protectedPay?'escrow':'instant',profile},ref:{id:terms.id,funding:fund.reference,operations,...(token?{usdcCodeHash:tokenCode}:{})},config,state,graphs,times,token,router};
}
function rpc(f,edit={}){return async(_,init)=>{const r=JSON.parse(init.body),p=r.params;let result;
  if(r.method==='status')result={chain_id:'mainnet',sync_info:{syncing:false}};
  else if(r.method==='block'){
    const hash=p.block_id===9820210?MAINNET_GENESIS_HASH:p.block_id??block;const index=[...f.times.keys()].indexOf(hash);
    result={header:{hash,prev_hash:H(8),height:p.block_id===9820210?9820210:index<0?20000020:20000000+index,timestamp_nanosec:f.times.get(hash)??'1793520800000000000'}};
  }else if(r.method==='EXPERIMENTAL_tx_status')result=f.graphs.get(p.tx_hash);
  else if(p.request_type==='view_account')result={amount:'10000000000000000000000000',locked:'0',storage_usage:100,code_hash:p.account_id===MAINNET_USDC?(edit.tokenCode??tokenCode):code,block_hash:p.block_id,block_height:20000020};
  else if(p.request_type==='view_access_key_list')result={block_hash:p.block_id,keys:[{public_key:key,access_key:{nonce:edit.keyActivity&&p.block_id===block?1:0,permission:'FullAccess'}}]};
  else result={result:[...Buffer.from(JSON.stringify(p.method_name==='get_config'?f.config:f.state))],logs:[],block_hash:block,block_height:20000020};
  return Response.json({jsonrpc:'2.0',id:r.id,result});};}
for(const options of [{},{token:true},{protectedPay:true},{protectedPay:true,refund:true},{protectedPay:true,token:true},{protectedPay:true,token:true,refund:true},{retry:true},{token:true,retry:true},{protectedPay:true,token:true,refund:true,retry:true},{router:true,token:true}]){
  test(`independent settlement ${JSON.stringify(options)} validates full exact graph and failed retry history`,async()=>{
    const f=scenario(options),proof=await verifyMainnetSettlement(f.input,f.ref,rpc(f));assert.equal(proof.kind,'VERIFIED_SETTLEMENT',JSON.stringify(proof));
    assert.equal(proof.status,options.refund?'REFUNDED':'PAID');assert.equal(proof.scope,'NEAR_SETTLEMENT_ONLY');assert.equal(proof.routerSurplusBaseUnits,options.router?'2':'0');
    for(const mutation of [x=>x.graphs.get(x.ref.operations.at(-1).transactionHash).receipts.at(-1).receipt.Action.input_data_ids=[H(7)],
      x=>x.graphs.get(x.ref.operations.at(-1).transactionHash).receipts_outcome.at(-1).outcome.status={Failure:{ActionError:{index:0}}},
      x=>x.graphs.get(x.ref.operations.at(-1).transactionHash).receipts.splice(-1),x=>x.graphs.get(x.ref.funding.transactionHash).final_execution_status='EXECUTED']){
      const changed=structuredClone(f);mutation(changed);assert.equal((await verifyMainnetSettlement(changed.input,changed.ref,rpc(changed))).kind,'NOT_VERIFIED');
    }
    if(options.retry){const changed=structuredClone(f);changed.ref.operations.shift();assert.equal((await verifyMainnetSettlement(changed.input,changed.ref,rpc(changed))).kind,'NOT_VERIFIED');}
    if(options.token)assert.equal((await verifyMainnetSettlement(f.input,f.ref,rpc(f,{tokenCode:H(8)}))).kind,'NOT_VERIFIED');
    assert.equal((await verifyMainnetSettlement(f.input,f.ref,rpc(f,{keyActivity:true}))).kind,'NOT_VERIFIED');
  });
}
