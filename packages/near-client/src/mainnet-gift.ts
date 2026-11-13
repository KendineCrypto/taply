import { z } from 'zod';
import { MainnetAccountSchema, U128Schema, U64Schema, parseStrictJson } from '@taply/shared';
import { GiftViewSchema, giftMessageProblem, isGiftId, type PreparedGiftCall } from './gift.js';
import { mainnetTransport, MainnetReadProfileSchema } from './mainnet-network.js';
import { AccountSchema, CallResultSchema, HashSchema } from './validation.js';
import { NearClientError, type Fetch } from './rpc.js';
import { ed25519SeedToPkcs8 } from './recovery-phrase.js';

export const MAINNET_GIFT_CLAIM_DOMAIN = 'taply-gift-claim:near-mainnet:v1';
const GiftAccount = MainnetAccountSchema.refine(id => !['taply-pay.kendinecrypto.near','devkendinecrypto.near','kendinecrypto.near','intents.near'].includes(id));
export const MainnetGiftConfigSchema = z.strictObject({ contract: z.literal('taply-gift-mainnet'), version: z.literal('0.2.0-mainnet'),
  network: z.literal('near-mainnet'), contractId: GiftAccount, testFaultBuild: z.literal(false),
  unknownCallbackPolicy: z.literal('PENDING_NO_RETRY_NO_ADMIN_OVERRIDE'), reviewStatus: z.literal('UNREVIEWED_NOT_FOR_REAL_FUNDS'),
  asset: z.literal('near:native'), giftFeeYocto: U128Schema, minAmountYocto: U128Schema, maxAmountYocto: U128Schema,
  minLifetimeS: z.literal('600'), maxLifetimeS: z.literal('2592000'), maxMessageBytes: z.literal(280), maxDesign: z.literal(7),
  claimDomain: z.literal(MAINNET_GIFT_CLAIM_DOMAIN) }).superRefine((c,ctx)=>{
    if (![c.minAmountYocto,c.maxAmountYocto,c.giftFeeYocto].every(v=>U128Schema.safeParse(v).success)) return;
    if (BigInt(c.minAmountYocto) === 0n || BigInt(c.minAmountYocto) > BigInt(c.maxAmountYocto) || BigInt(c.giftFeeYocto) === 0n ||
      !U128Schema.safeParse((BigInt(c.maxAmountYocto)+BigInt(c.giftFeeYocto)).toString()).success)
      ctx.addIssue({code:'custom',message:'INVALID_LIMITS'});
  });
export type MainnetGiftConfig = z.infer<typeof MainnetGiftConfigSchema>;
export const MainnetGiftProfileSchema = MainnetReadProfileSchema.extend({ contract: z.strictObject({ accountId: GiftAccount,
  expectedCodeHash: HashSchema, minAmountYocto: U128Schema, maxAmountYocto: U128Schema, giftFeeYocto: U128Schema }) });
export type MainnetGiftProfile = z.input<typeof MainnetGiftProfileSchema>;
export function mainnetGiftClaimMessage(contractId: string, giftId: string, claimant: string) {
  GiftAccount.parse(contractId); MainnetAccountSchema.parse(claimant);
  if (!isGiftId(giftId)) throw new Error('INVALID_GIFT_ID');
  return `${MAINNET_GIFT_CLAIM_DOMAIN}:${contractId}:${giftId}:${claimant}`;
}
/** One-use link-key signature, never a wallet/transaction signer. Seed stays with caller. */
export async function signMainnetGiftClaim(crypto: Crypto, seed: Uint8Array, contractId: string, giftId: string, claimant: string) {
  if (seed.length !== 32) throw new Error('INVALID_LINK_KEY');
  const bytes = ed25519SeedToPkcs8(seed);
  try {
    const key = await crypto.subtle.importKey('pkcs8', bytes, 'Ed25519', false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(mainnetGiftClaimMessage(contractId,giftId,claimant))));
    return Array.from(signature,b=>b.toString(16).padStart(2,'0')).join('');
  } finally { bytes.fill(0); }
}
export function prepareMainnetCreateGift(input: { config: MainnetGiftConfig; signerAccountId: string; giftId: string;
  publicKeyHex: string; amountYocto: string; lifetimeS: number; message: string; design: number }): PreparedGiftCall {
  const c = MainnetGiftConfigSchema.parse(input.config); MainnetAccountSchema.parse(input.signerAccountId); U128Schema.parse(input.amountYocto);
  if (input.signerAccountId === c.contractId || !isGiftId(input.giftId) || !/^[a-f0-9]{64}$/.test(input.publicKeyHex) ||
    BigInt(input.amountYocto) < BigInt(c.minAmountYocto) || BigInt(input.amountYocto) > BigInt(c.maxAmountYocto) ||
    !Number.isSafeInteger(input.lifetimeS) || input.lifetimeS < 600 || input.lifetimeS > 2592000 ||
    !Number.isInteger(input.design) || input.design < 0 || input.design > 7 || giftMessageProblem(input.message,c) !== null)
    throw new Error('INVALID_GIFT');
  const deposit = U128Schema.parse((BigInt(input.amountYocto)+BigInt(c.giftFeeYocto)).toString());
  return { receiverId:c.contractId, methodName:'create_gift', gas:'30000000000000', depositYocto:deposit,
    args:{ gift_id:input.giftId, public_key:input.publicKeyHex, amount:input.amountYocto, lifetime_s:input.lifetimeS, message:input.message, design:input.design } };
}
export function prepareMainnetGiftSettlement(input: { config: MainnetGiftConfig; gift: z.infer<typeof GiftViewSchema>;
  signerAccountId: string; observedAtNs: string; action: 'claim'|'refund'|'retry'; signatureHex?: string }): PreparedGiftCall {
  const c = MainnetGiftConfigSchema.parse(input.config), g = GiftViewSchema.parse(input.gift);
  MainnetAccountSchema.parse(input.signerAccountId); MainnetAccountSchema.parse(g.creator);
  if (g.beneficiary !== null) MainnetAccountSchema.parse(g.beneficiary);
  U64Schema.parse(input.observedAtNs);
  const open = g.status === 'AVAILABLE' || g.status === 'EXPIRED';
  if (input.action === 'claim') {
    if (!open || BigInt(input.observedAtNs) >= BigInt(g.expiresAtNs) || g.creator === input.signerAccountId || !/^[a-f0-9]{128}$/.test(input.signatureHex ?? '')) throw new Error('NOT_CLAIMABLE');
    return { receiverId:c.contractId, methodName:'claim_gift', args:{gift_id:g.id,signature:input.signatureHex},gas:'50000000000000',depositYocto:'0' };
  }
  if (input.action === 'refund') {
    if (!open || BigInt(input.observedAtNs) < BigInt(g.expiresAtNs) || g.creator !== input.signerAccountId) throw new Error('NOT_REFUNDABLE');
  } else if (input.action !== 'retry' || g.payout !== 'FAILED' || g.beneficiary !== input.signerAccountId) throw new Error('NO_CONFIRMED_FAILURE');
  return { receiverId:c.contractId, methodName:input.action === 'refund' ? 'refund_gift' : 'retry_payout', args:{gift_id:g.id}, gas:'50000000000000',depositYocto:'0' };
}
export function createMainnetGiftReader(input: MainnetGiftProfile, fetcher: Fetch = (url,init)=>globalThis.fetch(url,init)) {
  const p = MainnetGiftProfileSchema.parse(input), { contract, ...network } = p;
  const { rpc, finalBlock } = mainnetTransport(network, fetcher);
  async function view(method: string,args: object) {
    const block = await finalBlock();
    const account = AccountSchema.parse(await rpc('query',{request_type:'view_account',account_id:contract.accountId,block_id:block.hash}));
    if (account.block_hash !== block.hash || account.code_hash !== contract.expectedCodeHash) throw new NearClientError('CONTRACT_CODE_MISMATCH');
    async function call(name: string,parameters: object) {
      const result = CallResultSchema.parse(await rpc('query',{request_type:'call_function',account_id:contract.accountId,block_id:block.hash,
        method_name:name,args_base64:btoa(JSON.stringify(parameters))}));
      if (result.block_hash !== block.hash) throw new NearClientError('EVIDENCE_MISMATCH');
      return parseStrictJson(new Uint8Array(result.result));
    }
    const config = MainnetGiftConfigSchema.parse(await call('get_config',{}));
    if (config.contractId !== contract.accountId || config.minAmountYocto !== contract.minAmountYocto ||
      config.maxAmountYocto !== contract.maxAmountYocto || config.giftFeeYocto !== contract.giftFeeYocto) throw new NearClientError('EVIDENCE_MISMATCH');
    return { data:method === 'get_config' ? config : await call(method,args), config, blockHash:block.hash, timestampNs:block.timestampNs,
      finality:'final' as const, source:'rpc' as const, network:'near-mainnet' as const };
  }
  return Object.freeze({ async readConfig() { const r = await view('get_config',{}); return {...r,data:r.config}; },
    async readGift(id: string) {
      if (!isGiftId(id)) throw new Error('INVALID_GIFT_ID');
      const r = await view('get_gift',{gift_id:id}), gift = GiftViewSchema.nullable().parse(r.data);
      if (gift && gift.id !== id) throw new NearClientError('EVIDENCE_MISMATCH');
      if (gift) { MainnetAccountSchema.parse(gift.creator); if (gift.beneficiary) MainnetAccountSchema.parse(gift.beneficiary); }
      return {...r,data:gift};
    } });
}
