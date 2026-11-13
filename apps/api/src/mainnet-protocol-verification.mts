import {createMainnetReader,createMainnetEscrowReader,verifyMainnetCommerceBinding,
  verifyMainnetSettlement,verifyMainnetGiftSettlement,verifyMainnetUsdcTransfer,verifyMainnetDirectTransfer,
  type MainnetSigningProfiles,type MainnetCommerceSession} from '../../../packages/near-client/dist/index.js';

export type MainnetReceiptQuery=
 | {kind:'instant'|'escrow';reference:Parameters<typeof verifyMainnetSettlement>[1]}
 | {kind:'gift';reference:Parameters<typeof verifyMainnetGiftSettlement>[1]}
 | {kind:'usdc';reference:Parameters<typeof verifyMainnetUsdcTransfer>[1]}
 | {kind:'native';reference:Parameters<typeof verifyMainnetDirectTransfer>[1]};
/** Read-only integration. Server configuration supplies every code pin; browser
 * receipt readers remain the independent verifier. No server-paid flag or SSE
 * state can replace them. R-2/unknown graphs remain NOT_VERIFIED. */
export function createMainnetProtocolVerification(input:MainnetSigningProfiles,fetcher:typeof fetch=globalThis.fetch){
  const profiles=structuredClone(input);
  return Object.freeze({
    async receipt(query:MainnetReceiptQuery){
      if(query.kind==='native')return verifyMainnetDirectTransfer(profiles.network,query.reference,fetcher);
      if(query.kind==='usdc'){
        if(!profiles.usdcCodeHash||query.reference.usdcCodeHash!==profiles.usdcCodeHash)throw Error('TOKEN_PIN_REQUIRED');
        return verifyMainnetUsdcTransfer(profiles.network,query.reference,fetcher);
      }
      if(query.kind==='gift'){
        if(!profiles.gift)throw Error('GIFT_NOT_CONFIGURED');return verifyMainnetGiftSettlement(profiles.gift,query.reference,fetcher);
      }
      const profile=query.kind==='instant'?profiles.instant:profiles.escrow;
      if(!profile)throw Error('CONTRACT_NOT_CONFIGURED');
      if(query.reference.usdcCodeHash!==undefined&&query.reference.usdcCodeHash!==profiles.usdcCodeHash)throw Error('TOKEN_PIN_REQUIRED');
      return query.kind==='instant'?verifyMainnetSettlement({kind:'instant',profile:profiles.instant!},query.reference,fetcher):
        verifyMainnetSettlement({kind:'escrow',profile:profiles.escrow!},query.reference,fetcher);
    },
    async commerce(kind:'instant'|'escrow',session:MainnetCommerceSession,requestId:string,reviewedTermsHash:string){
      const profile=kind==='instant'?profiles.instant:profiles.escrow;
      if(!profile||profile.contract.accountId!==session.contractId)throw Error('CONTRACT_NOT_CONFIGURED');
      const read=kind==='instant'?await createMainnetReader(profiles.instant!,fetcher).readRequest(requestId):
        await createMainnetEscrowReader(profiles.escrow!,fetcher).readRequest(requestId);
      if(!read.data||!verifyMainnetCommerceBinding(kind,read.data.terms,session,reviewedTermsHash))throw Error('COMMERCE_NOT_VERIFIED');
      return {kind:'VERIFIED_CONTRACT_TERMS' as const,request:read,settlement:'NOT_ESTABLISHED' as const};
    },
  });
}
