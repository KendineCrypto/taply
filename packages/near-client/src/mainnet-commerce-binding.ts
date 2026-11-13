import {z} from 'zod';
import {MainnetAccountSchema,HashHexSchema,PositiveU64Schema,MainnetIntentTermsSchema,MainnetEscrowTermsSchema,
  calculateMainnetRequestId,calculateMainnetEscrowRequestId,calculateMainnetTermsHash,calculateMainnetEscrowTermsHash,
  canonicalJson,domainHash,type MainnetIntentTerms,type MainnetEscrowTerms} from '@taply/shared';

/** Public commitment metadata. Never put join tokens, bearer credentials or link keys here. */
export const MainnetCommerceSessionSchema=z.strictObject({version:z.literal('taply.commerce.v1'),
  network:z.literal('near-mainnet'),contractId:MainnetAccountSchema,merchantAccountId:MainnetAccountSchema,
  sessionId:HashHexSchema,sessionNonce:HashHexSchema,expiresAtNs:PositiveU64Schema});
export type MainnetCommerceSession=z.infer<typeof MainnetCommerceSessionSchema>;
type Terms=MainnetIntentTerms|MainnetEscrowTerms;
const prefix='taply-commerce-v1:';

/** Binds one immutable on-chain request to a sale/session without changing the
 * contract ABI. The contract authenticates creatorAccountId and hashes the memo.
 * This does NOT enable its disabled native Handshake/session-registry capability. */
export function bindMainnetCommerceTerms(kind:'instant'|'escrow',draft:Terms,session:MainnetCommerceSession){
  const s=MainnetCommerceSessionSchema.parse(session);
  const parse=(v:unknown)=>kind==='instant'?MainnetIntentTermsSchema.parse(v):MainnetEscrowTermsSchema.parse(v);
  const t=parse(draft);
  if(t.contractId!==s.contractId||t.creatorAccountId!==s.merchantAccountId||BigInt(t.fundingExpiresAtNs)>BigInt(s.expiresAtNs))throw Error('COMMERCE_IDENTITY_OR_EXPIRY_MISMATCH');
  if(t.memo.startsWith(prefix))throw Error('COMMERCE_ALREADY_BOUND');
  // Exclude mutable sale terms and expiry from the identity: changing either
  // cannot mint a second request for this same session identity.
  const creationNonce=domainHash('taply.commerce.identity.v1',canonicalJson({network:s.network,contractId:s.contractId,
    merchantAccountId:s.merchantAccountId,sessionId:s.sessionId,sessionNonce:s.sessionNonce}));
  const identity={network:t.network,contractId:t.contractId,creatorAccountId:t.creatorAccountId,creationNonce};
  const id=kind==='instant'?calculateMainnetRequestId({...identity,contractId:MainnetIntentTermsSchema.parse(t).contractId}):calculateMainnetEscrowRequestId(identity);
  const commitment=domainHash('taply.commerce.binding.v1',canonicalJson(s));
  const terms=parse({...t,id,creationNonce,memo:`${prefix}${commitment}\n${t.memo}`});
  const termsHash=kind==='instant'?calculateMainnetTermsHash(MainnetIntentTermsSchema.parse(terms)):calculateMainnetEscrowTermsHash(terms);
  return {terms,termsHash,binding: {session:s,requestId:id,termsHash,commitment}};
}

/** Compare against a FINAL request read through the pinned reader, not API hints.
 * expectedTermsHash must come from the payer's explicitly reviewed sale. */
export function verifyMainnetCommerceBinding(kind:'instant'|'escrow',observedTerms:unknown,session:MainnetCommerceSession,expectedTermsHash:string):boolean{
  try{
    const t=kind==='instant'?MainnetIntentTermsSchema.parse(observedTerms):MainnetEscrowTermsSchema.parse(observedTerms);
    const memo=t.memo; if(!memo.startsWith(prefix)||memo[ prefix.length+64 ]!=='\n')return false;
    const rebuilt=bindMainnetCommerceTerms(kind,{...t,memo:memo.slice(prefix.length+65)},session);
    return rebuilt.termsHash===HashHexSchema.parse(expectedTermsHash)&&canonicalJson(rebuilt.terms)===canonicalJson(t);
  }catch{return false;}
}
