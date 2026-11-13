import {z} from 'zod';
import {MainnetAccountSchema,U128Schema,canonicalJson,parseStrictJson} from '@taply/shared';
import {createMainnetReader,MainnetProfileSchema,type MainnetProfile} from './mainnet.js';
import {createMainnetGiftReader,MainnetGiftProfileSchema,mainnetGiftClaimMessage,type MainnetGiftProfile} from './mainnet-gift.js';
import {mainnetTransport,type MainnetReadProfile} from './mainnet-network.js';
import {readTransaction} from './transactions.js';
import {AccountSchema,HashSchema,RpcU64Schema,losslessStringify} from './validation.js';
import type {Fetch} from './rpc.js';

const Call=z.strictObject({FunctionCall:z.object({method_name:z.string(),args:z.string().max(8192),deposit:U128Schema,gas:RpcU64Schema})});
const Transfer=z.strictObject({Transfer:z.strictObject({deposit:U128Schema})});
const Action=z.union([Call,Transfer]);
const Receipt=z.object({receipt_id:HashSchema,predecessor_id:MainnetAccountSchema,receiver_id:MainnetAccountSchema,
  receipt:z.object({Action:z.object({signer_id:MainnetAccountSchema,actions:z.array(Action).min(1).max(4),
    input_data_ids:z.array(HashSchema).max(16),output_data_receivers:z.array(z.object({data_id:HashSchema,receiver_id:MainnetAccountSchema})).max(16)})})});
const Tx=z.object({transaction:z.object({hash:HashSchema,signer_id:MainnetAccountSchema,receiver_id:MainnetAccountSchema,actions:z.array(Action).length(1)}),
  receipts:z.array(z.unknown()).max(256)});
const Keys=z.object({block_hash:HashSchema,keys:z.array(z.object({public_key:z.string().max(256),access_key:z.object({nonce:RpcU64Schema,permission:z.unknown()})})).max(256)});
const Header=z.object({header:z.object({hash:HashSchema,prev_hash:HashSchema})});
function check(value:unknown):asserts value {if(!value)throw new Error('EVIDENCE_MISMATCH');}
function functionCall(action:z.infer<typeof Action>|undefined){check(action && 'FunctionCall' in action);return action.FunctionCall;}
function args(encoded:string):unknown {return parseStrictJson(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));}
function equal(a:unknown,b:unknown){return canonicalJson(a)===canonicalJson(b);}
type PayoutSpec={contractId:string;codeHash:string;stateBlock:string;stateTimestampNs:string;signer:string;txHash:string;
  beneficiary:string;amount:string;method:string;deposit:string;checkArgs:(value:unknown)=>Promise<boolean>|boolean;
  callbackMethod:string;callbackArgs:object;detached:boolean;startedAtNs:string;resolvedAtNs:string|null};
export type MainnetPayoutVerification={kind:'VERIFIED';network:'near-mainnet';transactionHash:string;blockHash:string;
  beneficiary:string;amountYocto:string;trustModel:'configured-rpc'}|{kind:'NOT_VERIFIED';reason:'UNSUPPORTED_PATH'|'UNRESOLVED'|'EVIDENCE_UNAVAILABLE_OR_MISMATCH'};

/** First-attempt native payout proof only. Retries and FT/router graphs fail
 * closed until their complete histories are implemented; no optimistic fallback. */
async function nativePayout(profile:MainnetReadProfile,s:PayoutSpec,fetcher:Fetch):Promise<MainnetPayoutVerification> {
  const {rpc,checkNetwork}=mainnetTransport(profile,fetcher);await checkNetwork();
  const raw=await rpc('EXPERIMENTAL_tx_status',{tx_hash:s.txHash,sender_account_id:s.signer,wait_until:'FINAL'});
  const observed=await readTransaction(async(method,params)=>method==='tx_status'?raw:rpc(method,params),{transactionHash:s.txHash,signerAccountId:s.signer});
  check(observed.assurance==='verified_final' && observed.data.outcomeGraphComplete);
  const t=Tx.parse(raw),tx=t.transaction,call=functionCall(tx.actions[0]);
  check(tx.hash===s.txHash && tx.signer_id===s.signer && tx.receiver_id===s.contractId && call.method_name===s.method && call.deposit===s.deposit && await s.checkArgs(args(call.args)));
  const nodes=new Map(observed.data.receiptOutcomes.map(o=>[o.id,o]));
  const payloads=new Map<string,z.infer<typeof Receipt>>();
  for(const value of t.receipts){const parsed=Receipt.safeParse(value);if(parsed.success){check(!payloads.has(parsed.data.receipt_id));payloads.set(parsed.data.receipt_id,parsed.data);}}
  const rootStatus=observed.data.transactionOutcome.status;check(rootStatus.kind==='SUCCESS_RECEIPT_ID');
  const root=nodes.get(rootStatus.receiptId),rootReceipt=payloads.get(rootStatus.receiptId);check(root && rootReceipt);
  check(root.executorAccountId===s.contractId && rootReceipt.predecessor_id===s.signer && rootReceipt.receiver_id===s.contractId &&
    rootReceipt.receipt.Action.signer_id===s.signer && equal(rootReceipt.receipt.Action.actions,tx.actions) && rootReceipt.receipt.Action.input_data_ids.length===0);
  const children=root.receiptIds.map(id=>{const p=payloads.get(id);check(p);return p;});
  const own=children.filter(p=>p.predecessor_id===s.contractId);check(own.length===2);
  const transfer=own.find(p=>Transfer.safeParse(p.receipt.Action.actions[0]).success),callback=own.find(p=>p.receipt.Action.actions[0] && 'FunctionCall' in p.receipt.Action.actions[0]);check(transfer && callback);
  check(transfer.receipt.Action.actions.length===1 && callback.receipt.Action.actions.length===1 && transfer.receiver_id===s.beneficiary && callback.receiver_id===s.contractId);
  check(Transfer.parse(transfer.receipt.Action.actions[0]).Transfer.deposit===s.amount);
  const cb=functionCall(callback.receipt.Action.actions[0]);
  check(cb.method_name===s.callbackMethod && cb.deposit==='0' && equal(args(cb.args),s.callbackArgs));
  const outputs=transfer.receipt.Action.output_data_receivers,inputs=callback.receipt.Action.input_data_ids;
  check(outputs.length===1 && outputs[0]?.receiver_id===s.contractId && inputs.length===1 && inputs[0]===outputs[0].data_id && transfer.receipt.Action.input_data_ids.length===0);
  check([...payloads.values()].filter(p=>p.receipt.Action.output_data_receivers.some(o=>o.data_id===inputs[0])).length===1);
  const paid=nodes.get(transfer.receipt_id),confirmed=nodes.get(callback.receipt_id);check(paid && confirmed);
  check(paid.executorAccountId===s.beneficiary && paid.status.kind==='SUCCESS_VALUE' && paid.status.valueBase64==='' &&
    confirmed.executorAccountId===s.contractId && confirmed.status.kind==='SUCCESS_VALUE' && confirmed.status.valueBase64==='dHJ1ZQ==');
  check(s.detached ? root.status.kind==='SUCCESS_VALUE' && root.status.valueBase64==='' : root.status.kind==='SUCCESS_RECEIPT_ID' && root.status.receiptId===callback.receipt_id);
  const refund=(p:z.infer<typeof Receipt>)=>p.predecessor_id==='system' && [s.signer,s.contractId].includes(p.receiver_id) &&
    p.receipt.Action.actions.length===1 && Transfer.safeParse(p.receipt.Action.actions[0]).success && p.receipt.Action.input_data_ids.length===0 && p.receipt.Action.output_data_receivers.length===0;
  for(const p of children.filter(p=>p.predecessor_id!==s.contractId))check(refund(p));
  for(const id of [...paid.receiptIds,...confirmed.receiptIds]){const p=payloads.get(id);check(p && refund(p));}
  const blocks=new Map(observed.data.blocks.map(b=>[b.hash,b]));
  check(blocks.get(root.blockHash)?.timestampNs===s.startedAtNs);
  if(s.resolvedAtNs!==null)check(blocks.get(confirmed.blockHash)?.timestampNs===s.resolvedAtNs);
  for(const block of blocks.values())check(BigInt(block.timestampNs)<=BigInt(s.stateTimestampNs));
  for(const hash of new Set([root.blockHash,confirmed.blockHash,s.stateBlock])){
    const account=AccountSchema.parse(await rpc('query',{request_type:'view_account',account_id:s.contractId,block_id:hash}));
    check(account.block_hash===hash && account.code_hash===s.codeHash);
  }
  const block=Header.parse(await rpc('block',{block_id:root.blockHash}));check(block.header.hash===root.blockHash);
  async function keys(hash:string){const k=Keys.parse(await rpc('query',{request_type:'view_access_key_list',account_id:s.contractId,block_id:hash}));check(k.block_hash===hash);
    return losslessStringify(k.keys.sort((a,b)=>a.public_key.localeCompare(b.public_key)));}
  // Any retained key activity could have swapped code between observations.
  check(await keys(block.header.prev_hash)===await keys(s.stateBlock));
  return {kind:'VERIFIED',network:'near-mainnet',transactionHash:s.txHash,blockHash:confirmed.blockHash,beneficiary:s.beneficiary,amountYocto:s.amount,trustModel:'configured-rpc'};
}

export async function verifyMainnetNativePayment(profile:MainnetProfile,ref:{id:string;txHash:string;signerAccountId:string},fetcher:Fetch=(u,i)=>globalThis.fetch(u,i)):Promise<MainnetPayoutVerification>{
  try{
    const p=MainnetProfileSchema.parse(profile),reader=createMainnetReader(profile,fetcher);
    await reader.readConfig();const state=await reader.readRequest(ref.id),r=state.data;
    if(!r || r.status!=='FINAL_PAID')return {kind:'NOT_VERIFIED',reason:'UNRESOLVED'};
    if(r.terms.assetId!=='near:native' || r.latestOperation?.nonce!=='1')return {kind:'NOT_VERIFIED',reason:'UNSUPPORTED_PATH'};
    check(r.payerAccountId===ref.signerAccountId);
    const {contract,...network}=p;
    return await nativePayout(network,{contractId:contract.accountId,codeHash:contract.expectedCodeHash,stateBlock:state.blockHash,stateTimestampNs:state.timestampNs,
      signer:ref.signerAccountId,txHash:ref.txHash,beneficiary:r.recipientAccountId,amount:r.terms.amountBaseUnits,method:'pay_instant_native',deposit:r.terms.amountBaseUnits,
      checkArgs:v=>equal(v,{id:r.terms.id,expectedTermsHash:r.termsHash}),callbackMethod:'on_native_transfer_complete',
      callbackArgs:{id:r.terms.id,operationNonce:'1',kind:'INSTANT_PAYOUT'},detached:false,startedAtNs:r.latestOperation.startedAtNs,resolvedAtNs:r.latestOperation.resolvedAtNs},fetcher);
  }catch{return {kind:'NOT_VERIFIED',reason:'EVIDENCE_UNAVAILABLE_OR_MISMATCH'};}
}

export async function verifyMainnetGiftReceipt(profile:MainnetGiftProfile,ref:{giftId:string;txHash:string;signerAccountId:string},fetcher:Fetch=(u,i)=>globalThis.fetch(u,i)):Promise<MainnetPayoutVerification>{
  try{
    const p=MainnetGiftProfileSchema.parse(profile),state=await createMainnetGiftReader(profile,fetcher).readGift(ref.giftId),g=state.data;
    if(!g || g.payout!=='CONFIRMED' || g.beneficiary===null || g.settledAtNs===null)return {kind:'NOT_VERIFIED',reason:'UNRESOLVED'};
    if(g.payoutNonce!==1)return {kind:'NOT_VERIFIED',reason:'UNSUPPORTED_PATH'};
    check(ref.signerAccountId===g.beneficiary);const refund=g.status==='REFUNDED';check(refund || g.status==='CLAIMED');
    const {contract,...network}=p;
    return await nativePayout(network,{contractId:contract.accountId,codeHash:contract.expectedCodeHash,stateBlock:state.blockHash,stateTimestampNs:state.timestampNs,
      signer:ref.signerAccountId,txHash:ref.txHash,beneficiary:g.beneficiary,amount:g.amountYocto,method:refund?'refund_gift':'claim_gift',deposit:'0',
      checkArgs:async v=>{
        if(refund)return equal(v,{gift_id:g.id});
        const a=z.strictObject({gift_id:z.literal(g.id),signature:z.string().regex(/^[a-f0-9]{128}$/)}).parse(v);
        const bytes=(s:string)=>Uint8Array.from(s.match(/../g)??[],b=>parseInt(b,16));
        const key=await crypto.subtle.importKey('raw',bytes(g.publicKey),'Ed25519',false,['verify']);
        return crypto.subtle.verify('Ed25519',key,bytes(a.signature),new TextEncoder().encode(mainnetGiftClaimMessage(contract.accountId,g.id,ref.signerAccountId)));
      },callbackMethod:'on_payout',callbackArgs:{gift_id:g.id,nonce:1},detached:true,startedAtNs:g.settledAtNs,resolvedAtNs:null},fetcher);
  }catch{return {kind:'NOT_VERIFIED',reason:'EVIDENCE_UNAVAILABLE_OR_MISMATCH'};}
}
