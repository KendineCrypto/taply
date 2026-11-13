import {PublicKey,actions,baseDecode,baseEncode,createTransaction,encodeTransaction} from 'near-api-js';
import {canonicalJson,parseStrictJson,MainnetAccountSchema} from '@taply/shared';
import {createMainnetOperationPlanner,type MainnetOperation,type MainnetSigningProfiles} from './mainnet-operation-policy.js';
import {createMainnetTransactionCoordinator,type MainnetGlobalAttemptStore,type MainnetPendingTransaction,MainnetReviewedActionSchema} from './mainnet-reconciliation.js';
import {createMainnetWalletChain} from './mainnet-wallet-chain.js';
import {EncryptedMainnetVault,MAINNET_PROTOCOL_SIGNING_RELEASED,signMainnetVaultTransaction} from './mainnet-vault.js';
import {OneShotMainnetProvider} from './mainnet-wallet-transport.js';
import {ed25519PublicKeyFromHex} from './wallet-chain.js';
import {HashSchema} from './validation.js';
import type {Fetch} from './rpc.js';
import type {z} from 'zod';

export interface MainnetNearConnectWallet {
  getAccounts():Promise<Array<{accountId:string;publicKey?:string}>>;
  signAndSendTransaction(params:{network:'mainnet';signerId:string;receiverId:string;actions:Array<
    {type:'Transfer';params:{deposit:string}}|{type:'FunctionCall';params:{methodName:string;args:object;gas:string;deposit:string}}> }):Promise<unknown>;
}
export function mainnetNearConnectParameters(accountId:string,receiverId:string,input:z.infer<typeof MainnetReviewedActionSchema>){
  MainnetAccountSchema.parse(accountId);MainnetAccountSchema.parse(receiverId);const a=MainnetReviewedActionSchema.parse(input);
  const action=a.kind==='transfer'?{type:'Transfer' as const,params:{deposit:a.depositYocto}}:
    {type:'FunctionCall' as const,params:{methodName:a.methodName,args:parseStrictJson(a.argsJson) as object,gas:a.gas,deposit:a.depositYocto}};
  return {network:'mainnet' as const,signerId:accountId,receiverId,actions:[action]};
}
export type MainnetWalletReview={id:string;network:'near-mainnet';accountId:string;publicKey:string;receiverId:string;
  action:z.infer<typeof MainnetReviewedActionSchema>;operationHash:string;nonce:string|null;minimumNonce:string;
  blockHash:string;blockHeight:string;gasReserveYocto:string;storageReserveYocto:string;expiresAtMs:number};
/** Unified policy path. Never accepts arbitrary caller transactions or raw keys.
 * The public submit gate and internal vault gate are independent and both closed. */
export function createMainnetWalletBackend(input:{profiles:MainnetSigningProfiles;store:MainnetGlobalAttemptStore;deviceId:string;
  signer:{kind:'internal';vault:EncryptedMainnetVault}|{kind:'near-connect';wallet:MainnetNearConnectWallet;accountId:string;publicKey:string}},
  fetcher:Fetch=(u,i)=>globalThis.fetch(u,i),now:()=>number=Date.now){
  const planner=createMainnetOperationPlanner(input.profiles,fetcher),chain=createMainnetWalletChain(input.profiles.network,fetcher);
  const journal=createMainnetTransactionCoordinator({store:input.store,deviceId:input.deviceId,profile:input.profiles.network},fetcher);
  const plans=new Map<string,{review:Readonly<MainnetWalletReview>;operation:MainnetOperation}>();
  async function identity(){
    if(input.signer.kind==='internal'){const id=input.signer.vault.getIdentity();if(!id||id.network!=='near-mainnet')throw Error('WALLET_NOT_CREATED');
      return {accountId:id.accountId,publicKey:ed25519PublicKeyFromHex(id.publicKeyHex)};}
    const signer=input.signer,accounts=await signer.wallet.getAccounts();
    if(!accounts.some(a=>a.accountId===signer.accountId&&a.publicKey===signer.publicKey))throw Error('EXTERNAL_IDENTITY_MISMATCH');
    return {accountId:signer.accountId,publicKey:signer.publicKey};
  }
  async function state(){const id=await identity(),s=await chain.snapshot(id.accountId,id.publicKey);if(!s)throw Error('ACCOUNT_NOT_ACTIVATED');return s;}
  return Object.freeze({
    async prepare(operation:MainnetOperation):Promise<Readonly<MainnetWalletReview>>{
      const s=await state(),ledger=await journal.read(s.accountId);
      if(ledger?.pending)throw Error('OUTCOME_UNRESOLVED');
      if(ledger&&ledger.ownerDeviceId!==input.deviceId)throw Error('OTHER_DEVICE_READ_ONLY');
      const op=structuredClone(operation),p=await planner.prepare(op,s);
      if(ledger?.completed.some(x=>x.attempt.operationHash===p.operationHash))throw Error('OPERATION_ALREADY_CONSUMED');
      const review=Object.freeze({id:crypto.randomUUID(),network:'near-mainnet' as const,accountId:s.accountId,publicKey:s.publicKey,
        receiverId:p.receiverId,action:p.action,operationHash:p.operationHash,nonce:input.signer.kind==='internal'?(BigInt(s.nonce)+1n).toString():null,
        minimumNonce:s.nonce,blockHash:s.blockHash,blockHeight:s.blockHeight,gasReserveYocto:p.gasReserveYocto,storageReserveYocto:p.storageReserveYocto,expiresAtMs:now()+60000});
      plans.clear();plans.set(review.id,{review,operation:op});return review;
    },
    async submit(reviewId:string,confirm:(review:Readonly<MainnetWalletReview>)=>Promise<boolean>){
      if(!MAINNET_PROTOCOL_SIGNING_RELEASED)throw Error('MAINNET_SIGNING_DISABLED');
      const plan=plans.get(reviewId);plans.delete(reviewId);if(!plan)throw Error('REVIEW_EXPIRED');
      const r=plan.review;
      const active=()=>{if(!MAINNET_PROTOCOL_SIGNING_RELEASED||now()>=r.expiresAtMs)throw Error('REVIEW_EXPIRED');};
      active();if(await confirm(r)!==true)throw Error('USER_REJECTED_BEFORE_HANDOFF');active();
      const s=await state(),fresh=await planner.prepare(plan.operation,s);active();
      if(s.accountId!==r.accountId||s.publicKey!==r.publicKey||s.nonce!==r.minimumNonce||fresh.operationHash!==r.operationHash||
        canonicalJson(fresh.action)!==canonicalJson(r.action)||fresh.receiverId!==r.receiverId||BigInt(s.blockHeight)<BigInt(r.blockHeight)||
        (s.blockHeight===r.blockHeight&&s.blockHash!==r.blockHash)||BigInt(fresh.gasReserveYocto)>BigInt(r.gasReserveYocto)||BigInt(fresh.storageReserveYocto)>BigInt(r.storageReserveYocto))throw Error('REVIEW_CHANGED');
      const attempt=await journal.reserve(r.operationHash,{accountId:r.accountId,publicKey:r.publicKey,receiverId:r.receiverId,action:r.action,
        nonce:r.nonce,minimumNonce:r.minimumNonce,anchorHash:r.blockHash,anchorHeight:r.blockHeight});
      let pending:MainnetPendingTransaction=attempt,hash:string|null=null;
      try{
        active();
        if(input.signer.kind==='internal'){
          const a=r.action,tx=createTransaction(r.accountId,PublicKey.fromString(r.publicKey),r.receiverId,BigInt(r.nonce!),
            [a.kind==='transfer'?actions.transfer(BigInt(a.depositYocto)):actions.functionCall(a.methodName,new TextEncoder().encode(a.argsJson),BigInt(a.gas),BigInt(a.depositYocto))],baseDecode(r.blockHash));
          const bytes=new Uint8Array(encodeTransaction(tx));hash=baseEncode(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
          // Persist the deterministic hash BEFORE asking the vault to sign.
          pending=await journal.handoff(attempt,hash);active();
          const signed=await signMainnetVaultTransaction(input.signer.vault,tx);active();signed.assertActive();
          if(baseEncode(signed.txHash)!==hash)throw Error('SIGNATURE_MISMATCH');
          await new OneShotMainnetProvider(input.profiles.network,fetcher,()=>{active();signed.assertActive();}).sendTransactionUntil(signed.signedTransaction,'FINAL');
        }else{
          pending=await journal.handoff(attempt,null);active();
          const id=await identity();active();if(id.accountId!==r.accountId||id.publicKey!==r.publicKey)throw Error('IDENTITY_CHANGED');
          const result=await input.signer.wallet.signAndSendTransaction(mainnetNearConnectParameters(r.accountId,r.receiverId,r.action));
          const value=result as {transaction?:{hash?:unknown}};hash=HashSchema.parse(value?.transaction?.hash);
        }
      }catch{/* Wallet rejection/timeout is not proof of non-submission. */}
      try{await journal.uncertain(pending,hash);}catch{/* Last acknowledged reservation still fences further handoff. */}
      return {kind:'OUTCOME_UNRESOLVED' as const,transactionHash:hash};
    },
    async readAttempt(){return journal.read((await identity()).accountId);},
    async reconcile(hashHint?:string){return journal.reconcile((await identity()).accountId,hashHint);},
  });
}
