import {PublicKey,Transaction,actions,baseDecode,baseEncode,createTransaction,encodeTransaction} from 'near-api-js';
import {MainnetAccountSchema,canonicalJson,domainHash} from '@taply/shared';
import {createMainnetWalletChain} from './mainnet-wallet-chain.js';
import {mainnetSpendingBudget,prepareMainnetNativeTransfer,type MainnetWalletSnapshot} from './mainnet-wallet-transfer.js';
import {mainnetTransport,type MainnetReadProfile} from './mainnet-network.js';
import {createMainnetAttemptJournal,type MainnetAttemptStore} from './mainnet-attempts.js';
import {EncryptedMainnetVault,signMainnetVaultTransaction,MAINNET_PROTOCOL_SIGNING_RELEASED} from './mainnet-vault.js';
import {AccountSchema,HashSchema} from './validation.js';
import {ed25519PublicKeyFromHex} from './wallet-chain.js';
import type {Fetch} from './rpc.js';
import {OneShotMainnetProvider} from './mainnet-wallet-transport.js';

export interface MainnetNativeReview {
  readonly id:string;readonly network:'near-mainnet';readonly signerAccountId:string;readonly publicKey:string;
  readonly receiverId:string;readonly depositYocto:string;readonly nonce:string;readonly blockHash:string;
  readonly gasReserveYocto:string;readonly storageReserveYocto:string;readonly expiresAtMs:number;
}
/** Interface for a future separately accepted physical wallet adapter. The adapter
 * must be Mainnet-only and must not add access keys. A timeout is never rejection proof. */
export interface MainnetExternalSigner {
  readonly network:'near-mainnet';readonly accountId:string;readonly publicKey:string;
  signAndSendNativeTransfer(review:Readonly<MainnetNativeReview>):Promise<{transactionHash:string}>;
}
/** Native Send/Personal Gift confirmation engine. Built behind an immutable closed
 * gate. General contract calls are deliberately not accepted by this signer.
 * USDC/escrow/Gift builders remain unsigned until their signing-policy review. */
export function createMainnetNativeWalletBackend(input:{profile:MainnetReadProfile;store:MainnetAttemptStore;
  signer:{kind:'internal';vault:EncryptedMainnetVault}|{kind:'external';adapter:MainnetExternalSigner}},
  fetcher:Fetch=(u,i)=>globalThis.fetch(u,i),now:()=>number=Date.now) {
  const chain=createMainnetWalletChain(input.profile,fetcher),transport=mainnetTransport(input.profile,fetcher),journal=createMainnetAttemptJournal(input.store);
  const plans=new Map<string,{review:MainnetNativeReview;state:MainnetWalletSnapshot;bytes:Uint8Array}>();
  function identity(){
    if(input.signer.kind==='internal'){
      const id=input.signer.vault.getIdentity();if(!id || id.network!=='near-mainnet')throw new Error('WALLET_NOT_CREATED');
      return {accountId:id.accountId,publicKey:ed25519PublicKeyFromHex(id.publicKeyHex)};
    }
    if(input.signer.adapter.network!=='near-mainnet')throw new Error('NETWORK_MISMATCH');
    return {accountId:MainnetAccountSchema.parse(input.signer.adapter.accountId),publicKey:input.signer.adapter.publicKey};
  }
  async function snapshot(){const id=identity(),s=await chain.snapshot(id.accountId,id.publicKey);if(!s)throw new Error('ACCOUNT_NOT_ACTIVATED');return s;}
  async function receiver(id:string,block:string){
    const result=AccountSchema.parse(await transport.rpc('query',{request_type:'view_account',account_id:id,block_id:block}));
    if(result.block_hash!==block)throw new Error('EVIDENCE_MISMATCH');
  }
  return Object.freeze({
    async prepare(receiverId:string,amountNear:string):Promise<MainnetNativeReview>{
      MainnetAccountSchema.parse(receiverId);const state=await snapshot();
      if(await journal.read(state.accountId))throw new Error('OUTCOME_UNRESOLVED');
      const prepared=prepareMainnetNativeTransfer(state,receiverId,amountNear);await receiver(receiverId,state.blockHash);
      const tx=createTransaction(state.accountId,PublicKey.fromString(state.publicKey),receiverId,BigInt(state.nonce)+1n,
        [actions.transfer(BigInt(prepared.depositYocto))],baseDecode(state.blockHash));
      const review=Object.freeze({id:crypto.randomUUID(),network:'near-mainnet' as const,signerAccountId:state.accountId,publicKey:state.publicKey,
        receiverId,depositYocto:prepared.depositYocto,nonce:tx.nonce.toString(),blockHash:state.blockHash,gasReserveYocto:prepared.gasReserveYocto,
        storageReserveYocto:prepared.storageReserveYocto,expiresAtMs:now()+60000});
      plans.clear();plans.set(review.id,{review,state,bytes:new Uint8Array(encodeTransaction(tx))});return review;
    },
    async submit(reviewId:string,confirm:(review:Readonly<MainnetNativeReview>)=>Promise<boolean>){
      // No caller option, environment variable or adapter can enable this.
      if(!MAINNET_PROTOCOL_SIGNING_RELEASED)throw new Error('MAINNET_SIGNING_DISABLED');
      const plan=plans.get(reviewId);plans.delete(reviewId);if(!plan || now()>=plan.review.expiresAtMs)throw new Error('REVIEW_EXPIRED');
      if(await confirm(plan.review)!==true)throw new Error('REVIEW_REJECTED');
      const current=await snapshot(),budget=mainnetSpendingBudget(current,plan.review.depositYocto);
      if(now()>=plan.review.expiresAtMs || current.accountId!==plan.state.accountId || current.publicKey!==plan.state.publicKey || current.nonce!==plan.state.nonce ||
        BigInt(current.blockHeight)<BigInt(plan.state.blockHeight) || (current.blockHeight===plan.state.blockHeight && current.blockHash!==plan.state.blockHash) ||
        BigInt(budget.gasReserveYocto)>BigInt(plan.review.gasReserveYocto) || BigInt(budget.storageReserveYocto)>BigInt(plan.review.storageReserveYocto))throw new Error('REVIEW_EXPIRED');
      await receiver(plan.review.receiverId,current.blockHash);
      const reserved=await journal.reserve(current.accountId,domainHash('taply.mainnet-wallet-review.v1',canonicalJson(plan.review)));
      let handoff=reserved,hash:string|null=null;
      try{
        if(input.signer.kind==='internal'){
          const signed=await signMainnetVaultTransaction(input.signer.vault,Transaction.decode(plan.bytes));
          hash=baseEncode(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(plan.bytes))));
          if(hash!==baseEncode(signed.txHash))throw new Error('SIGNATURE_INVALID');signed.assertActive();
          handoff=await journal.transition(reserved,'HANDOFF',hash);signed.assertActive();
          if(now()>=plan.review.expiresAtMs)throw new Error('REVIEW_EXPIRED');
          await transport.checkNetwork();signed.assertActive();
          const provider=new OneShotMainnetProvider(input.profile,fetcher,()=>{
            if(!MAINNET_PROTOCOL_SIGNING_RELEASED || now()>=plan.review.expiresAtMs)throw new Error('SIGNING_DISABLED');signed.assertActive();
          });
          await provider.sendTransactionUntil(signed.signedTransaction,'FINAL');
        }else{
          handoff=await journal.transition(reserved,'HANDOFF');
          const result=await input.signer.adapter.signAndSendNativeTransfer(plan.review);hash=HashSchema.parse(result.transactionHash);
        }
      }catch{/* Reservation/handoff already blocks replay, even if the following write fails. */}
      try{await journal.transition(handoff,'UNCERTAIN',hash);}catch{/* Never erase or reissue. */}
      return {kind:'OUTCOME_UNRESOLVED' as const,transactionHash:hash};
    },
    readAttempt:()=>journal.read(identity().accountId),
  });
}
