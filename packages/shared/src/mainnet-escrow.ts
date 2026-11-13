import { z } from 'zod';
import { AmountSchema, HashHexSchema, MemoSchema, PositiveU64Schema, U64Schema } from './primitives.js';
import { MainnetAccountSchema, MAINNET_USDC_ASSET, MAINNET_NATIVE_CAP, MAINNET_USDC_CAP } from './mainnet.js';
import { canonicalJson, domainHash } from './json.js';

export const MainnetEscrowAccountSchema = MainnetAccountSchema.refine(id => !['taply-pay.kendinecrypto.near','devkendinecrypto.near','kendinecrypto.near','intents.near'].includes(id));
const identity = z.strictObject({ network:z.literal('near-mainnet'), contractId:MainnetEscrowAccountSchema,
  creatorAccountId:MainnetAccountSchema, creationNonce:HashHexSchema });
export function calculateMainnetEscrowRequestId(input:z.infer<typeof identity>) { return domainHash('taply.id.v1',canonicalJson(identity.parse(input))); }
export const MainnetEscrowTermsSchema = z.strictObject({ schemaVersion:z.literal('taply.intent.v1'), id:HashHexSchema,
  network:z.literal('near-mainnet'), contractId:MainnetEscrowAccountSchema, creatorAccountId:MainnetAccountSchema, creationNonce:HashHexSchema,
  assetId:z.enum(['near:native',MAINNET_USDC_ASSET]), amountBaseUnits:AmountSchema, mode:z.enum(['instant','protected']),
  cancelDurationNs:U64Schema.nullable(), fundingExpiresAtNs:PositiveU64Schema, permittedPayerAccountId:MainnetAccountSchema.nullable(),
  merchantAccountId:z.null(), sessionBinding:z.null(), memo:MemoSchema }).superRefine((t,ctx)=>{
    const issue=(message:string)=>ctx.addIssue({code:'custom',message});
    if (!AmountSchema.safeParse(t.amountBaseUnits).success || (t.cancelDurationNs!==null && !U64Schema.safeParse(t.cancelDurationNs).success)) return;
    if (t.creatorAccountId===t.contractId) issue('SELF_RECIPIENT');
    if (BigInt(t.amountBaseUnits)>BigInt(t.assetId==='near:native'?MAINNET_NATIVE_CAP:MAINNET_USDC_CAP)) issue('CAP_EXCEEDED');
    if (t.mode==='instant' ? t.cancelDurationNs!==null : t.cancelDurationNs===null || BigInt(t.cancelDurationNs)<60000000000n || BigInt(t.cancelDurationNs)>3600000000000n) issue('INVALID_CANCEL_DURATION');
    const i=identity.safeParse({network:t.network,contractId:t.contractId,creatorAccountId:t.creatorAccountId,creationNonce:t.creationNonce});
    if (i.success && t.id!==calculateMainnetEscrowRequestId(i.data)) issue('REQUEST_ID_MISMATCH');
  });
export type MainnetEscrowTerms = z.infer<typeof MainnetEscrowTermsSchema>;
export function calculateMainnetEscrowTermsHash(input:MainnetEscrowTerms) { return domainHash('taply.terms.v1',canonicalJson(MainnetEscrowTermsSchema.parse(input))); }
