import {z} from 'zod';
import {MainnetAccountSchema,U128Schema,U64Schema,HashHexSchema,canonicalJson,parseStrictJson} from '@taply/shared';
import {HashSchema,RpcU64Schema} from './validation.js';
import {mainnetTransport,type MainnetReadProfile} from './mainnet-network.js';
import {readTransaction} from './transactions.js';
import type {Fetch} from './rpc.js';

export const MainnetReviewedActionSchema=z.union([
  z.strictObject({kind:z.literal('transfer'),depositYocto:U128Schema}),
  z.strictObject({kind:z.literal('call'),methodName:z.string().regex(/^[a-z_]{1,64}$/),
    argsJson:z.string().max(16384).refine(s=>{try{return canonicalJson(parseStrictJson(s))===s;}catch{return false;}}),
    gas:U64Schema.refine(v=>BigInt(v)>0n&&BigInt(v)<=300000000000000n),depositYocto:U128Schema}),
]);
export const MainnetTransactionExpectationSchema=z.strictObject({accountId:MainnetAccountSchema,
  publicKey:z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),receiverId:MainnetAccountSchema,
  action:MainnetReviewedActionSchema,nonce:U64Schema.nullable(),minimumNonce:U64Schema,
  anchorHash:HashSchema,anchorHeight:U64Schema});
export type MainnetTransactionExpectation=z.infer<typeof MainnetTransactionExpectationSchema>;
export type MainnetExecutionProof={kind:'FINAL_EXECUTION';transactionHash:string;nonce:string;
  execution:'SUCCESS'|'FAILURE';allReceiptsSucceeded:boolean;blockHash:string;blockHeight:string;
  settlement:'NOT_ESTABLISHED';trustModel:'configured-rpc'};
const Tx=z.object({transaction:z.object({hash:HashSchema,signer_id:MainnetAccountSchema,receiver_id:MainnetAccountSchema,
  public_key:z.string(),nonce:RpcU64Schema,actions:z.array(z.unknown()).length(1)})});
/** A FINAL failure may have successful descendant transfers. It NEVER permits
 * repeating the business operation. This proves execution, not settlement. */
export async function verifyMainnetTransactionExecution(profile:MainnetReadProfile,expectation:MainnetTransactionExpectation,
  transactionHash:string,fetcher:Fetch=(u,i)=>globalThis.fetch(u,i)):Promise<MainnetExecutionProof|null>{
  try{
    const e=MainnetTransactionExpectationSchema.parse(expectation);HashSchema.parse(transactionHash);
    const {rpc,checkNetwork}=mainnetTransport(profile,fetcher);await checkNetwork();
    const raw=await rpc('EXPERIMENTAL_tx_status',{tx_hash:transactionHash,sender_account_id:e.accountId,wait_until:'FINAL'});
    const t=Tx.parse(raw).transaction;
    if(t.hash!==transactionHash||t.signer_id!==e.accountId||t.public_key!==e.publicKey||t.receiver_id!==e.receiverId||
      BigInt(t.nonce)<=BigInt(e.minimumNonce)||(e.nonce!==null&&t.nonce!==e.nonce))return null;
    const action=e.action;
    if(action.kind==='transfer'){
      const a=z.strictObject({Transfer:z.strictObject({deposit:U128Schema})}).parse(t.actions[0]);
      if(a.Transfer.deposit!==action.depositYocto)return null;
    }else{
      const a=z.strictObject({FunctionCall:z.strictObject({method_name:z.string(),args:z.string().max(32768),gas:RpcU64Schema,deposit:U128Schema})}).parse(t.actions[0]).FunctionCall;
      if(a.method_name!==action.methodName||a.gas!==action.gas||a.deposit!==action.depositYocto||
        canonicalJson(parseStrictJson(Uint8Array.from(atob(a.args),c=>c.charCodeAt(0))))!==action.argsJson)return null;
    }
    const observed=await readTransaction(async(method,params)=>method==='tx_status'?raw:rpc(method,params),{transactionHash,signerAccountId:e.accountId});
    if(observed.assurance!=='verified_final'||!observed.data.outcomeGraphComplete)return null;
    const sent=observed.data.blocks.find(b=>b.hash===observed.data.transactionOutcome.blockHash);
    if(!sent||BigInt(sent.height)<BigInt(e.anchorHeight)||(sent.height===e.anchorHeight&&sent.hash!==e.anchorHash))return null;
    const execution=observed.data.status.kind==='SUCCESS_VALUE'?'SUCCESS':observed.data.status.kind==='FAILURE'?'FAILURE':null;
    if(execution===null)return null;
    return {kind:'FINAL_EXECUTION',transactionHash,nonce:t.nonce,execution,
      allReceiptsSucceeded:observed.data.receiptOutcomes.every(r=>r.status.kind==='SUCCESS_VALUE'||r.status.kind==='SUCCESS_RECEIPT_ID'),
      blockHash:observed.block.hash,blockHeight:observed.block.height,settlement:'NOT_ESTABLISHED',trustModel:'configured-rpc'};
  }catch{return null;}
}

/** Must be one authenticated account-global durable authority, not localStorage
 * or an expiring lock. The server binds authenticated account/device ownership.
 * No production endpoint is enabled by this interface. */
export interface MainnetGlobalAttemptStore {
  readonly scope:'account-global';
  read(accountId:string):Promise<string|null>;
  compareAndSwap(accountId:string,expected:string|null,next:string):Promise<boolean>;
}
const Pending=z.strictObject({attemptId:z.uuid(),operationHash:HashHexSchema,deviceId:z.uuid(),
  state:z.enum(['RESERVED','HANDOFF','UNCERTAIN']),expectation:MainnetTransactionExpectationSchema,transactionHash:HashSchema.nullable()});
export type MainnetPendingTransaction=z.infer<typeof Pending>;
const Proof=z.strictObject({kind:z.literal('FINAL_EXECUTION'),transactionHash:HashSchema,nonce:U64Schema,
  execution:z.enum(['SUCCESS','FAILURE']),allReceiptsSucceeded:z.boolean(),blockHash:HashSchema,blockHeight:U64Schema,
  settlement:z.literal('NOT_ESTABLISHED'),trustModel:z.literal('configured-rpc')});
const Ledger=z.strictObject({version:z.literal(2),network:z.literal('near-mainnet'),accountId:MainnetAccountSchema,
  ownerDeviceId:z.uuid(),revision:U64Schema,pending:Pending.nullable(),
  completed:z.array(z.strictObject({attempt:Pending,proof:Proof})).max(256)});
/** No delete/TTL/reset/takeover. At 256 completed entries fail closed until an
 * audited archival scheme exists; never silently discard replay tombstones. */
export function createMainnetTransactionCoordinator(input:{store:MainnetGlobalAttemptStore;deviceId:string;profile:MainnetReadProfile},
  fetcher:Fetch=(u,i)=>globalThis.fetch(u,i)){
  if(input.store.scope!=='account-global')throw new Error('GLOBAL_AUTHORITY_REQUIRED');z.uuid().parse(input.deviceId);
  async function load(accountId:string){
    MainnetAccountSchema.parse(accountId);const raw=await input.store.read(accountId);
    if(raw!==null&&raw.length>8*1024*1024)throw new Error('INVALID_LEDGER');
    const value=raw===null?null:Ledger.parse(parseStrictJson(raw));
    if(value&&value.accountId!==accountId)throw new Error('INVALID_LEDGER');return {raw,value};
  }
  async function save(accountId:string,raw:string|null,value:z.infer<typeof Ledger>){
    value.revision=U64Schema.parse((BigInt(value.revision)+1n).toString());
    const next=JSON.stringify(Ledger.parse(value));
    if(new TextEncoder().encode(next).byteLength>65536)throw new Error('ARCHIVE_REQUIRED');
    if(!await input.store.compareAndSwap(accountId,raw,next))throw new Error('STALE_ATTEMPT');
  }
  return Object.freeze({
    async read(accountId:string){return (await load(accountId)).value;},
    async reserve(operationHash:string,expectation:MainnetTransactionExpectation):Promise<MainnetPendingTransaction>{
      const e=MainnetTransactionExpectationSchema.parse(expectation);HashHexSchema.parse(operationHash);
      const {raw,value}=await load(e.accountId);
      const ledger=value??{version:2 as const,network:'near-mainnet' as const,accountId:e.accountId,ownerDeviceId:input.deviceId,revision:'0',pending:null,completed:[]};
      if(ledger.ownerDeviceId!==input.deviceId)throw new Error('OTHER_DEVICE_READ_ONLY');
      if(ledger.pending)throw new Error('OUTCOME_UNRESOLVED');
      if(ledger.completed.length>=256)throw new Error('ARCHIVE_REQUIRED');
      if(ledger.completed.some(x=>x.attempt.operationHash===operationHash))throw new Error('OPERATION_ALREADY_CONSUMED');
      for(const item of ledger.completed)if(item.attempt.expectation.publicKey===e.publicKey&&BigInt(e.minimumNonce)<BigInt(item.proof.nonce))throw new Error('STALE_NONCE');
      const attempt=Pending.parse({attemptId:crypto.randomUUID(),operationHash,deviceId:input.deviceId,state:'RESERVED',expectation:e,transactionHash:null});
      ledger.pending=attempt;await save(e.accountId,raw,ledger);return Object.freeze(attempt);
    },
    async handoff(expected:MainnetPendingTransaction,transactionHash:string|null){
      const a=Pending.parse(expected),{raw,value}=await load(a.expectation.accountId);
      if(!value||value.ownerDeviceId!==input.deviceId||canonicalJson(value.pending)!==canonicalJson(a)||a.state!=='RESERVED')throw new Error('STALE_ATTEMPT');
      const next=Pending.parse({...a,state:'HANDOFF',transactionHash});value.pending=next;
      await save(a.expectation.accountId,raw,value);return Object.freeze(next);
    },
    async uncertain(expected:MainnetPendingTransaction,transactionHash:string|null){
      const a=Pending.parse(expected),{raw,value}=await load(a.expectation.accountId);
      if(!value||value.ownerDeviceId!==input.deviceId||canonicalJson(value.pending)!==canonicalJson(a)||
        (a.transactionHash!==null&&a.transactionHash!==transactionHash))throw new Error('STALE_ATTEMPT');
      const next=Pending.parse({...a,state:'UNCERTAIN',transactionHash});value.pending=next;
      await save(a.expectation.accountId,raw,value);return Object.freeze(next);
    },
    async reconcile(accountId:string,hashHint?:string){
      const {raw,value}=await load(accountId),a=value?.pending;
      if(!value||!a)return {kind:'NO_PENDING_ATTEMPT' as const};
      // NEAR Connect does not bind an exact nonce before handoff. After a lost
      // response, an arbitrary matching hash could be an unrelated identical
      // transfer while this attempt is still live. Never retire that reservation
      // using a manually supplied hint alone. Exact-nonce internal attempts and
      // external hashes already retained from handoff remain independently checked.
      if(a.expectation.nonce===null&&a.transactionHash===null)return {kind:'OUTCOME_UNRESOLVED' as const};
      const hash=a.transactionHash??hashHint;
      if(!hash||(a.transactionHash!==null&&hashHint!==undefined&&hashHint!==a.transactionHash))return {kind:'OUTCOME_UNRESOLVED' as const};
      const proof=await verifyMainnetTransactionExecution(input.profile,a.expectation,hash,fetcher);
      if(!proof)return {kind:'OUTCOME_UNRESOLVED' as const};
      value.completed.push({attempt:a,proof});value.pending=null;
      await save(accountId,raw,value);return proof;
    },
  });
}
