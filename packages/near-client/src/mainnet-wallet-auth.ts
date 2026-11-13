import {z} from 'zod';
import {MainnetAccountSchema,HashHexSchema,canonicalJson} from '@taply/shared';
import type {MainnetWalletAuthority} from './mainnet-wallet-v2.js';
import type {bindMainnetCommerceTerms} from './mainnet-commerce-binding.js';

export type MainnetAuthorityCommand=
 | {method:'read'}
 | {method:'reserve';args:Parameters<MainnetWalletAuthority['reserve']>}
 | {method:'handoff';args:Parameters<MainnetWalletAuthority['handoff']>}
 | {method:'uncertain';args:Parameters<MainnetWalletAuthority['uncertain']>}
 | {method:'reconcile';hashHint?:string}
 | {method:'bindCommerce';args:Parameters<typeof bindMainnetCommerceTerms>};
export const MainnetAuthorityChallengeSchema=z.strictObject({id:z.uuid(),network:z.literal('near-mainnet'),
 purpose:z.literal('taply-wallet-authority-v1'),origin:z.literal('https://mainnet.taplyapp.xyz'),accountId:MainnetAccountSchema,
 publicKey:z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),deviceId:z.uuid(),nonceBase64:z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
 expiresAtMs:z.number().int().safe().positive(),commandHash:HashHexSchema,policyHash:HashHexSchema,
 recipient:z.literal('https://mainnet.taplyapp.xyz'),message:z.string().max(4096)});
export type MainnetAuthorityChallenge=z.infer<typeof MainnetAuthorityChallengeSchema>;
/** Compare local intended command AND deployment policy before wallet review.
 * Hashes use the same SHA-256 operation as the server (domainHash with empty
 * domain would insert a newline, therefore strip no data/use WebCrypto here). */
export async function mainnetAuthorityMessageParameters(input:unknown,expected:{accountId:string;publicKey:string;command:MainnetAuthorityCommand;policyHash:string},now=Date.now()){
  const c=MainnetAuthorityChallengeSchema.parse(input),{message,...fields}=c;
  const bytes=new TextEncoder().encode(canonicalJson(expected.command));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
  if(c.accountId!==expected.accountId||c.publicKey!==expected.publicKey||c.policyHash!==expected.policyHash||
    c.commandHash!==hash||message!==canonicalJson(fields)||c.expiresAtMs<=now||c.expiresAtMs>now+120000)throw Error('INVALID_AUTHORITY_CHALLENGE');
  const nonce=Uint8Array.from(atob(c.nonceBase64),x=>x.charCodeAt(0));
  if(nonce.length!==32||btoa(String.fromCharCode(...nonce))!==c.nonceBase64)throw Error('INVALID_AUTHORITY_CHALLENGE');
  return {network:'mainnet' as const,signerId:c.accountId,message,recipient:c.recipient,nonce};
}
/** Fixed NEP-413 serialization for the already checked authority challenge only.
 * Does not sign, expose keys or encode NEAR transactions. */
export function mainnetAuthorityPayload(parameters:Awaited<ReturnType<typeof mainnetAuthorityMessageParameters>>):Uint8Array<ArrayBuffer>{
  const text=(s:string)=>{const b=new TextEncoder().encode(s),n=new Uint8Array(4);new DataView(n.buffer).setUint32(0,b.length,true);return [...n,...b];};
  const tag=new Uint8Array(4);new DataView(tag.buffer).setUint32(0,2147484061,true);
  return new Uint8Array([...tag,...text(parameters.message),...parameters.nonce,...text(parameters.recipient),0]);
}
