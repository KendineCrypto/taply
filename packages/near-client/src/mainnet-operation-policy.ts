import {z} from 'zod';
import {MainnetAccountSchema,MainnetRequestSchema,MainnetEscrowRequestSchema,MAINNET_USDC,U128Schema,
  canonicalJson,parseStrictJson,domainHash,HashHexSchema,type MainnetIntentTerms,type MainnetEscrowTerms} from '@taply/shared';
import {mainnetTransport,type MainnetReadProfile} from './mainnet-network.js';
import {AccountSchema,CallResultSchema,HashSchema} from './validation.js';
import {MainnetProfileSchema,MainnetContractConfigSchema,prepareMainnetPayment,prepareMainnetCreateRequest,
  prepareMainnetCancelUnfunded,prepareMainnetRetryPayout,prepareMainnetTokenStorageDeposit,type MainnetProfile,type MainnetCall} from './mainnet.js';
import {MainnetGiftProfileSchema,MainnetGiftConfigSchema,prepareMainnetCreateGift,prepareMainnetGiftSettlement,type MainnetGiftProfile} from './mainnet-gift.js';
import {GiftViewSchema} from './gift.js';
import {MainnetEscrowProfileSchema,MainnetEscrowConfigSchema,prepareMainnetCreateProtectedRequest,prepareMainnetFundProtectedNative,
  prepareMainnetProtectedTokenFunding,prepareMainnetCancelProtected,prepareMainnetReleaseProtected,prepareMainnetRetryProtectedTransfer,type MainnetEscrowProfile} from './mainnet-escrow-client.js';
import {prepareMainnetNativeTransfer,prepareMainnetUsdcTransfer,mainnetSpendingBudget,MainnetWalletSnapshotSchema,type MainnetWalletSnapshot} from './mainnet-wallet-transfer.js';
import {MainnetReviewedActionSchema} from './mainnet-reconciliation.js';
import type {Fetch} from './rpc.js';

export type MainnetOperation=
 |{kind:'nativeSend';receiverId:string;amountNear:string;businessId:string}
 |{kind:'usdcSend';receiverId:string;amountBaseUnits:string;businessId:string}
 |{kind:'registerUsdc'}
 |{kind:'instantCreate';terms:MainnetIntentTerms}
 |{kind:'instantPay'|'instantCancel'|'instantRetry';id:string}
 |{kind:'escrowCreate';terms:MainnetEscrowTerms}
 |{kind:'escrowFund';id:string;acceptedCancelDurationNs:string}
 |{kind:'escrowCancel'|'escrowRelease'|'escrowRetry';id:string}
 |{kind:'giftCreate';giftId:string;publicKeyHex:string;amountYocto:string;lifetimeS:number;message:string;design:number}
 |{kind:'giftClaim';giftId:string;signatureHex:string}
 |{kind:'giftRefund'|'giftRetry';giftId:string};
export interface MainnetSigningProfiles {network:MainnetReadProfile;instant?:MainnetProfile;escrow?:MainnetEscrowProfile;gift?:MainnetGiftProfile;usdcCodeHash?:string}
const storage=z.strictObject({total:U128Schema,available:U128Schema}).nullable();
/** Reconstructs a single permitted action from fresh block-anchored chain data.
 * Caller-supplied method/action JSON is not an input. Public builder, not signer. */
export function createMainnetOperationPlanner(profiles:MainnetSigningProfiles,fetcher:Fetch=(u,i)=>globalThis.fetch(u,i)){
  const {rpc}=mainnetTransport(profiles.network,fetcher);
  return Object.freeze({async prepare(operation:MainnetOperation,snapshot:MainnetWalletSnapshot){
    const s=MainnetWalletSnapshotSchema.parse(snapshot),op=structuredClone(operation);
    let call:MainnetCall|undefined,receiverId:string,action:z.infer<typeof MainnetReviewedActionSchema>;
    async function account(id:string,codeHash?:string){MainnetAccountSchema.parse(id);
      const a=AccountSchema.parse(await rpc('query',{request_type:'view_account',account_id:id,block_id:s.blockHash}));
      if(a.block_hash!==s.blockHash||a.block_height!==s.blockHeight||(codeHash!==undefined&&a.code_hash!==HashSchema.parse(codeHash)))throw Error('EVIDENCE_MISMATCH');return a;}
    async function view(id:string,method:string,args:object){const r=CallResultSchema.parse(await rpc('query',{request_type:'call_function',account_id:id,block_id:s.blockHash,method_name:method,
      args_base64:btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args))))}));
      if(r.block_hash!==s.blockHash||r.block_height!==s.blockHeight)throw Error('EVIDENCE_MISMATCH');return parseStrictJson(new Uint8Array(r.result));}
    async function token(recipient:string,amount:string){
      if(!profiles.usdcCodeHash)throw Error('TOKEN_CODE_PIN_REQUIRED');await account(MAINNET_USDC,profiles.usdcCodeHash);
      const [balance,from,to]=await Promise.all([view(MAINNET_USDC,'ft_balance_of',{account_id:s.accountId}),view(MAINNET_USDC,'storage_balance_of',{account_id:s.accountId}),view(MAINNET_USDC,'storage_balance_of',{account_id:recipient})]);
      if(BigInt(U128Schema.parse(balance))<BigInt(U128Schema.parse(amount))||!storage.parse(from)||!storage.parse(to))throw Error('TOKEN_BALANCE_OR_STORAGE');
      return {blockHash:s.blockHash,accountId:s.accountId,receiverId:recipient,balance:U128Schema.parse(balance),senderRegistered:true,receiverRegistered:true};
    }
    if(op.kind==='nativeSend'){
      HashHexSchema.parse(op.businessId);const p=prepareMainnetNativeTransfer(s,op.receiverId,op.amountNear);await account(p.receiverId);
      receiverId=p.receiverId;action={kind:'transfer',depositYocto:p.depositYocto};
    }else{
      if(op.kind==='usdcSend'){
        HashHexSchema.parse(op.businessId);const evidence=await token(op.receiverId,op.amountBaseUnits);
        call=prepareMainnetUsdcTransfer({snapshot:s,receiverId:op.receiverId,amountBaseUnits:op.amountBaseUnits,tokenEvidence:evidence});
      }else if(op.kind==='registerUsdc'){
        if(!profiles.usdcCodeHash||!profiles.instant)throw Error('PROFILE_REQUIRED');await account(MAINNET_USDC,profiles.usdcCodeHash);
        if(storage.parse(await view(MAINNET_USDC,'storage_balance_of',{account_id:s.accountId})))throw Error('ALREADY_REGISTERED');
        const bounds=z.strictObject({min:U128Schema,max:U128Schema.nullable()}).parse(await view(MAINNET_USDC,'storage_balance_bounds',{}));
        call=prepareMainnetTokenStorageDeposit(profiles.instant,s.accountId,bounds.min);
      }else if(op.kind==='instantCreate'||op.kind==='instantPay'||op.kind==='instantCancel'||op.kind==='instantRetry'){
        const p=MainnetProfileSchema.parse(profiles.instant);await account(p.contract.accountId,p.contract.expectedCodeHash);
        const config=MainnetContractConfigSchema.parse(await view(p.contract.accountId,'get_config',{}));if(config.contractId!==p.contract.accountId)throw Error('WRONG_CONTRACT');
        if(op.kind==='instantCreate'){
          const quote=z.strictObject({requestId:HashHexSchema,termsHash:HashHexSchema,quoteVersion:z.string(),depositYocto:U128Schema,gas:z.string(),storageBytes:z.string().optional()}).parse(await view(p.contract.accountId,'quote_create_request',{terms:op.terms}));
          call=prepareMainnetCreateRequest({profile:p,terms:op.terms,signerAccountId:s.accountId,quote});
        }else{
          const r=MainnetRequestSchema.parse(await view(p.contract.accountId,'get_request',{id:HashHexSchema.parse(op.id)}));
          if(r.terms.id!==op.id||r.terms.contractId!==p.contract.accountId)throw Error('REQUEST_MISMATCH');
          const common={profile:p,terms:r.terms,status:r.status,signerAccountId:s.accountId};
          call=op.kind==='instantPay'?prepareMainnetPayment({...common,termsHash:r.termsHash,observedAtNs:s.blockTimestampNs}):op.kind==='instantCancel'?prepareMainnetCancelUnfunded(common):prepareMainnetRetryPayout({...common,operationNonce:r.latestOperation?.nonce??'0'});
        }
      }else if(op.kind==='escrowCreate'||op.kind==='escrowFund'||op.kind==='escrowCancel'||op.kind==='escrowRelease'||op.kind==='escrowRetry'){
        const p=MainnetEscrowProfileSchema.parse(profiles.escrow);await account(p.contract.accountId,p.contract.expectedCodeHash);
        const config=MainnetEscrowConfigSchema.parse(await view(p.contract.accountId,'get_config',{}));
        if(op.kind==='escrowCreate'){
          const quote=await view(p.contract.accountId,'quote_create_request',{terms:op.terms});
          call=prepareMainnetCreateProtectedRequest({contractId:p.contract.accountId,config,terms:op.terms,quote:quote as Parameters<typeof prepareMainnetCreateProtectedRequest>[0]['quote'],signerAccountId:s.accountId});
        }else{
          const request=MainnetEscrowRequestSchema.parse(await view(p.contract.accountId,'get_request',{id:HashHexSchema.parse(op.id)}));
          if(request.terms.id!==op.id||request.terms.contractId!==p.contract.accountId)throw Error('REQUEST_MISMATCH');
          const common={contractId:p.contract.accountId,config,request,signerAccountId:s.accountId,observedAtNs:s.blockTimestampNs};
          call=op.kind==='escrowFund'?(request.terms.assetId==='near:native'?prepareMainnetFundProtectedNative({...common,acceptedCancelDurationNs:op.acceptedCancelDurationNs}):prepareMainnetProtectedTokenFunding({...common,acceptedCancelDurationNs:op.acceptedCancelDurationNs})):
            op.kind==='escrowCancel'?prepareMainnetCancelProtected(common):op.kind==='escrowRelease'?prepareMainnetReleaseProtected(common):prepareMainnetRetryProtectedTransfer(common);
        }
      }else{
        const p=MainnetGiftProfileSchema.parse(profiles.gift);await account(p.contract.accountId,p.contract.expectedCodeHash);
        const config=MainnetGiftConfigSchema.parse(await view(p.contract.accountId,'get_config',{}));
        if(config.contractId!==p.contract.accountId||config.minAmountYocto!==p.contract.minAmountYocto||config.maxAmountYocto!==p.contract.maxAmountYocto||config.giftFeeYocto!==p.contract.giftFeeYocto)throw Error('CONFIG_MISMATCH');
        if(op.kind==='giftCreate'){
          if(await view(p.contract.accountId,'get_gift',{gift_id:op.giftId})!==null)throw Error('GIFT_ID_CONSUMED');
          call=prepareMainnetCreateGift({...op,config,signerAccountId:s.accountId});
        }else if(op.kind==='giftClaim'||op.kind==='giftRefund'||op.kind==='giftRetry'){
          const gift=GiftViewSchema.parse(await view(p.contract.accountId,'get_gift',{gift_id:op.giftId}));if(gift.id!==op.giftId)throw Error('GIFT_MISMATCH');
          call=prepareMainnetGiftSettlement({config,gift,signerAccountId:s.accountId,observedAtNs:s.blockTimestampNs,
            action:op.kind==='giftClaim'?'claim':op.kind==='giftRefund'?'refund':'retry',...(op.kind==='giftClaim'?{signatureHex:op.signatureHex}:{})});
        }else throw Error('UNSUPPORTED_OPERATION');
      }
      if(!call)throw Error('UNSUPPORTED_OPERATION');
      if(call.receiverId===MAINNET_USDC&&call.methodName==='ft_transfer_call')await token(String(call.args.receiver_id),String(call.args.amount));
      receiverId=call.receiverId;action=MainnetReviewedActionSchema.parse({kind:'call',methodName:call.methodName,argsJson:canonicalJson(call.args),gas:call.gas,depositYocto:call.depositYocto});
    }
    const budget=mainnetSpendingBudget(s,action.depositYocto);
    // Excludes chain nonce/reference block: a changed nonce cannot rename the same business operation.
    const operationHash=domainHash('taply.mainnet.operation.v2',canonicalJson({accountId:s.accountId,receiverId,action,
      businessId:op.kind==='nativeSend'||op.kind==='usdcSend'?op.businessId:null}));
    return Object.freeze({operationHash,receiverId,action:Object.freeze(action),...budget});
  }});
}
