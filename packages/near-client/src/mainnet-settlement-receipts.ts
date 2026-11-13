import {z} from 'zod';
import {MainnetAccountSchema,MAINNET_USDC,MAINNET_USDC_ASSET,U128Schema,canonicalJson,parseStrictJson} from '@taply/shared';
import {MainnetProfileSchema,createMainnetReader,type MainnetProfile} from './mainnet.js';
import {MainnetEscrowProfileSchema,createMainnetEscrowReader,type MainnetEscrowProfile} from './mainnet-escrow-client.js';
import {mainnetTransport,type MainnetReadProfile} from './mainnet-network.js';
import {readTransaction} from './transactions.js';
import {AccountSchema,HashSchema,RpcU64Schema,losslessStringify} from './validation.js';
import type {ExecutionOutcome} from './types.js';
import type {Fetch} from './rpc.js';

const Call=z.strictObject({FunctionCall:z.object({method_name:z.string(),args:z.string().max(32768),deposit:U128Schema,gas:RpcU64Schema})});
const Transfer=z.strictObject({Transfer:z.strictObject({deposit:U128Schema})});
const Receipt=z.object({receipt_id:HashSchema,predecessor_id:MainnetAccountSchema,receiver_id:MainnetAccountSchema,
  receipt:z.object({Action:z.object({signer_id:MainnetAccountSchema,actions:z.array(z.union([Call,Transfer])).length(1),
    input_data_ids:z.array(HashSchema).max(16),output_data_receivers:z.array(z.object({data_id:HashSchema,receiver_id:MainnetAccountSchema})).max(16)})})});
type Payload=z.infer<typeof Receipt>;
export interface MainnetSettlementTransaction {transactionHash:string;signerAccountId:string}
export type MainnetSettlementReference={id:string;funding:MainnetSettlementTransaction;
  /** One entry per operation nonce, starting at 1. Every earlier payout must have a verified failed transfer AND successful false callback. */
  operations:MainnetSettlementTransaction[];usdcCodeHash?:string};
export type MainnetSettlementProof={kind:'VERIFIED_SETTLEMENT';network:'near-mainnet';status:'PAID'|'REFUNDED';
  assetId:string;amountBaseUnits:string;beneficiary:string;operationNonce:string;fundingTransactionHash:string;
  settlementTransactionHash:string;transferReceiptId:string;callbackReceiptId:string;stateBlockHash:string;
  routerDelivery:boolean;routerSurplusBaseUnits:string;scope:'NEAR_SETTLEMENT_ONLY';trustModel:'configured-rpc'}|
  {kind:'NOT_VERIFIED';reason:'UNRESOLVED'|'EVIDENCE_UNAVAILABLE_OR_MISMATCH'};
function check(v:unknown):asserts v{if(!v)throw Error('EVIDENCE_MISMATCH');}
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
function decode(s:string){return parseStrictJson(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));}
function call(p:Payload){const a=p.receipt.Action.actions[0];check(a&&'FunctionCall'in a);return a.FunctionCall;}
const value=(o:ExecutionOutcome,s:string)=>o.status.kind==='SUCCESS_VALUE'&&o.status.valueBase64===btoa(s);

function verifier(network:MainnetReadProfile,fetcher:Fetch){
  const {rpc,checkNetwork}=mainnetTransport(network,fetcher);
  async function graph(ref:MainnetSettlementTransaction){
    HashSchema.parse(ref.transactionHash);MainnetAccountSchema.parse(ref.signerAccountId);
    const raw=await rpc('EXPERIMENTAL_tx_status',{tx_hash:ref.transactionHash,sender_account_id:ref.signerAccountId,wait_until:'FINAL'});
    const observed=await readTransaction(async(m,p)=>m==='tx_status'?raw:rpc(m,p),ref);
    check(observed.assurance==='verified_final'&&observed.data.outcomeGraphComplete);
    const envelope=z.object({transaction:z.object({actions:z.array(z.union([Call,Transfer])).length(1)}),receipts:z.array(z.unknown()).max(256)}).parse(raw);
    const payloads=new Map<string,Payload>(),nodes=new Map(observed.data.receiptOutcomes.map(o=>[o.id,o]));
    for(const raw of envelope.receipts){const p=Receipt.parse(raw);check(!payloads.has(p.receipt_id)&&nodes.has(p.receipt_id));payloads.set(p.receipt_id,p);}
    check(payloads.size===nodes.size);
    const status=observed.data.transactionOutcome.status;check(status.kind==='SUCCESS_RECEIPT_ID');
    const root=payloads.get(status.receiptId);check(root&&root.predecessor_id===ref.signerAccountId&&root.receiver_id===observed.data.receiverAccountId&&
      root.receipt.Action.signer_id===ref.signerAccountId&&same(root.receipt.Action.actions,envelope.transaction.actions)&&root.receipt.Action.input_data_ids.length===0);
    const parent=new Map<string,string>();for(const n of nodes.values())for(const id of n.receiptIds)parent.set(id,n.id);
    const blocks=new Map(observed.data.blocks.map(b=>[b.hash,b]));
    const outcome=(p:Payload)=>{const n=nodes.get(p.receipt_id);check(n&&n.executorAccountId===p.receiver_id);return n;};
    const time=(p:Payload)=>{const b=blocks.get(outcome(p).blockHash);check(b);return b.timestampNs;};
    const children=(p:Payload)=>outcome(p).receiptIds.map(id=>{const r=payloads.get(id);check(r);return r;});
    const dependency=(producer:Payload,consumer:Payload)=>{
      const outputs=producer.receipt.Action.output_data_receivers,inputs=consumer.receipt.Action.input_data_ids;
      check(outputs.length===1&&outputs[0]?.receiver_id===consumer.receiver_id&&inputs.length===1&&inputs[0]===outputs[0].data_id);
      check([...payloads.values()].filter(p=>p.receipt.Action.output_data_receivers.some(o=>o.data_id===inputs[0])).length===1);
    };
    return {ref,root,nodes,payloads,parent,blocks,outcome,time,children,dependency,observed};
  }
  type Graph=Awaited<ReturnType<typeof graph>>;
  function exactCall(p:Payload,predecessor:string,receiver:string,method:string,args:object,deposit:string){
    const c=call(p);check(p.predecessor_id===predecessor&&p.receiver_id===receiver&&c.method_name===method&&c.deposit===deposit&&same(decode(c.args),args));
  }
  function systemRefund(p:Payload){check(p.predecessor_id==='system'&&Transfer.safeParse(p.receipt.Action.actions[0]).success&&p.receipt.Action.input_data_ids.length===0&&p.receipt.Action.output_data_receivers.length===0);}
  function payout(g:Graph,source:Payload,s:{contract:string;beneficiary:string;amount:string;token:boolean;id:string;nonce:string;kind:string;success:boolean}){
    const own=g.children(source).filter(p=>p.predecessor_id===s.contract);check(own.length===2);
    const cb=own.find(p=>p.receiver_id===s.contract&&'FunctionCall' in p.receipt.Action.actions[0]!&&call(p).method_name==='on_native_transfer_complete');
    check(cb);const paid=own.find(p=>p!==cb);check(paid);
    exactCall(cb,s.contract,s.contract,'on_native_transfer_complete',{id:s.id,operationNonce:s.nonce,kind:s.kind},'0');
    if(s.token)exactCall(paid,s.contract,MAINNET_USDC,'ft_transfer',{receiver_id:s.beneficiary,amount:s.amount,memo:'Taply settlement'},'1');
    else check(paid.predecessor_id===s.contract&&paid.receiver_id===s.beneficiary&&Transfer.parse(paid.receipt.Action.actions[0]).Transfer.deposit===s.amount);
    check(paid.receipt.Action.input_data_ids.length===0);g.dependency(paid,cb);
    const p=g.outcome(paid),c=g.outcome(cb);check(value(c,s.success?'true':'false'));
    if(s.success)check(p.status.kind==='SUCCESS_VALUE'&&(s.token?atob(p.status.valueBase64).length<=256:p.status.valueBase64===''));
    else check(p.status.kind==='FAILURE');
    for(const r of g.children(source).filter(p=>!own.includes(p)))systemRefund(r);
    for(const r of [...g.children(paid),...g.children(cb)])systemRefund(r);
    return {paid,callback:cb};
  }
  async function pin(accountId:string,codeHash:string,graphs:Graph[],stateBlock:string,stateTimestamp:string){
    HashSchema.parse(codeHash);check(codeHash!=='11111111111111111111111111111111');
    const blocks=new Map(graphs.flatMap(g=>[...g.blocks.values()].map(b=>[b.hash,b] as const)));
    for(const b of blocks.values())check(BigInt(b.timestampNs)<=BigInt(stateTimestamp));
    for(const hash of new Set([...blocks.keys(),stateBlock])){const a=AccountSchema.parse(await rpc('query',{request_type:'view_account',account_id:accountId,block_id:hash}));check(a.block_hash===hash&&a.code_hash===codeHash);}
    const first=[...blocks.values()].sort((a,b)=>BigInt(a.height)<BigInt(b.height)?-1:1)[0];check(first);
    const header=z.object({header:z.object({hash:HashSchema,prev_hash:HashSchema})}).parse(await rpc('block',{block_id:first.hash}));check(header.header.hash===first.hash);
    async function keys(hash:string){const r=z.object({block_hash:HashSchema,keys:z.array(z.object({public_key:z.string(),access_key:z.object({nonce:RpcU64Schema,permission:z.unknown()})})).max(256)}).parse(await rpc('query',{request_type:'view_access_key_list',account_id:accountId,block_id:hash}));check(r.block_hash===hash);return losslessStringify(r.keys.sort((a,b)=>a.public_key.localeCompare(b.public_key)));}
    check(await keys(header.header.prev_hash)===await keys(stateBlock));
  }
  return {graph,exactCall,payout,pin,checkNetwork};
}

/** Complete NEAR-side direct/router USDC and native escrow settlement history.
 * No upstream Base/Solana/Tron debit or refund claim. Release gates stay false. */
export async function verifyMainnetSettlement(input:{kind:'instant';profile:MainnetProfile}|{kind:'escrow';profile:MainnetEscrowProfile},
  ref:MainnetSettlementReference,fetcher:Fetch=(u,i)=>globalThis.fetch(u,i)):Promise<MainnetSettlementProof>{
  try{
    const p=input.kind==='instant'?MainnetProfileSchema.parse(input.profile):MainnetEscrowProfileSchema.parse(input.profile);
    const reader=input.kind==='instant'?createMainnetReader(input.profile,fetcher):createMainnetEscrowReader(input.profile,fetcher);
    await reader.readConfig();const state=await reader.readRequest(ref.id),r=state.data;
    if(!r||!['FINAL_PAID','CANCELLED_REFUNDED'].includes(r.status)||!r.latestOperation||r.latestOperation.status!=='SUCCEEDED')return {kind:'NOT_VERIFIED',reason:'UNRESOLVED'};
    const op=r.latestOperation,token=r.terms.assetId===MAINNET_USDC_ASSET,router=r.payerAccountId==='intents.near',contract=p.contract.accountId;
    check(ref.operations.length>0&&ref.operations.length<=32&&String(ref.operations.length)===op.nonce&&r.payerAccountId&&r.fundedAtNs);
    check(!router||input.kind==='instant'&&token);if(token)check(ref.usdcCodeHash);
    const {contract:deployment,...network}=p;
    const v=verifier(network,fetcher);await v.checkNetwork();
    const cache=new Map<string,Awaited<ReturnType<typeof v.graph>>>();
    async function get(reference:MainnetSettlementTransaction){const key=canonicalJson(reference);let g=cache.get(key);if(!g){g=await v.graph(reference);cache.set(key,g);}return g;}
    const funded=await get(ref.funding);let fundingSource=funded.root,surplus='0';
    if(token){
      const msg=r.terms.mode==='protected'?{id:ref.id,expectedTermsHash:r.termsHash,action:'fund_protected',acceptedCancelDurationNs:r.terms.cancelDurationNs,consentVersion:'taply.protected-consent.v1'}:{id:ref.id,expectedTermsHash:r.termsHash,action:'pay_instant'};
      const candidates=[...funded.payloads.values()].filter(x=>x.receiver_id===contract&&x.predecessor_id===MAINNET_USDC&&'FunctionCall' in x.receipt.Action.actions[0]!&&call(x).method_name==='ft_on_transfer');check(candidates.length===1);fundingSource=candidates[0]!;
      const a=z.strictObject({sender_id:MainnetAccountSchema,amount:U128Schema,msg:z.string()}).parse(decode(call(fundingSource).args));
      check(a.sender_id===r.payerAccountId&&same(parseStrictJson(a.msg),msg)&&call(fundingSource).deposit==='0');
      check(router?BigInt(a.amount)>=BigInt(r.terms.amountBaseUnits):a.amount===r.terms.amountBaseUnits);surplus=(BigInt(a.amount)-BigInt(r.terms.amountBaseUnits)).toString();
      const parent=funded.payloads.get(funded.parent.get(fundingSource.receipt_id)??'');check(parent);
      const transferArgs=z.strictObject({receiver_id:MainnetAccountSchema,amount:U128Schema,msg:z.string(),memo:z.string().max(256).nullable().optional()}).parse(decode(call(parent).args));
      check(transferArgs.receiver_id===contract&&transferArgs.amount===a.amount&&transferArgs.msg===a.msg);
      v.exactCall(parent,r.payerAccountId,MAINNET_USDC,'ft_transfer_call',transferArgs,'1');
      if(!router)check(parent===funded.root&&ref.funding.signerAccountId===r.payerAccountId);
      check(value(funded.outcome(fundingSource),'"0"'));
      const resolver=funded.children(parent).find(x=>x.receiver_id===MAINNET_USDC&&x.predecessor_id===MAINNET_USDC&&'FunctionCall' in x.receipt.Action.actions[0]!&&call(x).method_name==='ft_resolve_transfer');check(resolver);
      v.exactCall(resolver,MAINNET_USDC,MAINNET_USDC,'ft_resolve_transfer',{sender_id:r.payerAccountId,receiver_id:contract,amount:a.amount},'0');
      funded.dependency(fundingSource,resolver);check(value(funded.outcome(resolver),JSON.stringify(a.amount)));
    }else{
      check(ref.funding.signerAccountId===r.payerAccountId);
      v.exactCall(fundingSource,r.payerAccountId,contract,r.terms.mode==='protected'?'fund_protected_native':'pay_instant_native',
        r.terms.mode==='protected'?{id:ref.id,expectedTermsHash:r.termsHash,acceptedCancelDurationNs:r.terms.cancelDurationNs,consentVersion:'taply.protected-consent.v1'}:{id:ref.id,expectedTermsHash:r.termsHash},r.terms.amountBaseUnits);
    }
    check(funded.time(fundingSource)===r.fundedAtNs);
    if(r.terms.mode==='protected')check(funded.outcome(fundingSource).status.kind==='SUCCESS_VALUE');
    let last:ReturnType<typeof v.payout>|undefined,lastGraph:Awaited<ReturnType<typeof v.graph>>|undefined,previousResolved=r.fundedAtNs;
    const seen=new Set<string>();
    for(let i=0;i<ref.operations.length;i++){
      const reference=ref.operations[i]!;check(!seen.has(reference.transactionHash));seen.add(reference.transactionHash);
      const g=await get(reference);let source=g.root;
      if(i===0&&r.terms.mode==='instant'){check(reference.transactionHash===ref.funding.transactionHash&&reference.signerAccountId===ref.funding.signerAccountId);source=fundingSource;}
      else if(i===0){
        const refund=op.kind==='PROTECTED_REFUND';check(r.cancelUntilNs);
        if(refund)check(reference.signerAccountId===r.payerAccountId&&BigInt(g.time(source))<BigInt(r.cancelUntilNs));else check(BigInt(g.time(source))>=BigInt(r.cancelUntilNs));
        v.exactCall(source,reference.signerAccountId,contract,refund?'cancel_protected':'release_protected',refund?{id:ref.id,expectedTermsHash:r.termsHash}:{id:ref.id},'1');
      }else{
        check(reference.signerAccountId===op.destinationAccountId);
        v.exactCall(source,reference.signerAccountId,contract,'retry_native_transfer',{id:ref.id,expectedOperationNonce:String(i)},'1');
      }
      check(BigInt(g.time(source))>=BigInt(previousResolved));
      last=v.payout(g,source,{contract,beneficiary:op.destinationAccountId,amount:r.terms.amountBaseUnits,token,id:ref.id,nonce:String(i+1),kind:op.kind,success:i===ref.operations.length-1});
      const outcome=g.outcome(source);
      if(!(i===0&&token&&r.terms.mode==='instant'))check(outcome.status.kind==='SUCCESS_RECEIPT_ID'&&outcome.status.receiptId===last.callback.receipt_id);
      previousResolved=g.time(last.callback);lastGraph=g;
      if(i===ref.operations.length-1)check(g.time(source)===op.startedAtNs&&g.time(last.callback)===op.resolvedAtNs);
    }
    check(last&&lastGraph);
    await v.pin(contract,deployment.expectedCodeHash,[...cache.values()],state.blockHash,state.timestampNs);
    if(token)await v.pin(MAINNET_USDC,ref.usdcCodeHash!,[...cache.values()],state.blockHash,state.timestampNs);
    return {kind:'VERIFIED_SETTLEMENT',network:'near-mainnet',status:r.status==='CANCELLED_REFUNDED'?'REFUNDED':'PAID',assetId:r.terms.assetId,
      amountBaseUnits:r.terms.amountBaseUnits,beneficiary:op.destinationAccountId,operationNonce:op.nonce,fundingTransactionHash:ref.funding.transactionHash,
      settlementTransactionHash:lastGraph.ref.transactionHash,transferReceiptId:last.paid.receipt_id,callbackReceiptId:last.callback.receipt_id,stateBlockHash:state.blockHash,
      routerDelivery:router,routerSurplusBaseUnits:surplus,scope:'NEAR_SETTLEMENT_ONLY',trustModel:'configured-rpc'};
  }catch{return {kind:'NOT_VERIFIED',reason:'EVIDENCE_UNAVAILABLE_OR_MISMATCH'};}
}
