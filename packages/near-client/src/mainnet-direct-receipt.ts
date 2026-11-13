import { z } from 'zod';
import { MainnetAccountSchema, U128Schema } from '@taply/shared';
import { HashSchema, BlockSchema } from './validation.js';
import { mainnetTransport, type MainnetReadProfile } from './mainnet-network.js';
import { NearClientError, type Fetch } from './rpc.js';

const Success = z.strictObject({ SuccessValue:z.literal('') });
const Outcome = z.object({ executor_id:MainnetAccountSchema, status:z.unknown(), receipt_ids:z.array(HashSchema).max(128) });
const Transaction = z.object({ final_execution_status:z.literal('FINAL'), status:Success,
  transaction:z.object({hash:HashSchema, signer_id:MainnetAccountSchema, receiver_id:MainnetAccountSchema,
    actions:z.array(z.strictObject({Transfer:z.strictObject({deposit:U128Schema})})).length(1)}),
  transaction_outcome:z.object({id:HashSchema, block_hash:HashSchema, outcome:Outcome}),
  receipts_outcome:z.array(z.object({id:HashSchema,block_hash:HashSchema,outcome:Outcome})).min(1).max(128) });
export type MainnetDirectReceipt = {kind:'VERIFIED';network:'near-mainnet';transactionHash:string;from:string;to:string;amountYocto:string;
  blockHash:string;blockTimestampNs:string;trustModel:'configured-rpc'} | {kind:'NOT_VERIFIED';reason:'MISMATCH'|'UNAVAILABLE'|'NOT_FOUND'};
/** Exact personal Gift/native transfer verification. Contract state, events and
 * balance deltas are never substitutes for a successful FINAL transfer receipt. */
export async function verifyMainnetDirectTransfer(profile:MainnetReadProfile, ref:{txHash:string;from:string;to:string;amountYocto:string},
  fetcher:Fetch=(url,init)=>globalThis.fetch(url,init)):Promise<MainnetDirectReceipt> {
  if (!HashSchema.safeParse(ref.txHash).success || !MainnetAccountSchema.safeParse(ref.from).success ||
    !MainnetAccountSchema.safeParse(ref.to).success || !U128Schema.safeParse(ref.amountYocto).success || ref.amountYocto === '0')
    return {kind:'NOT_VERIFIED',reason:'MISMATCH'};
  try {
    const {rpc,finalBlock}=mainnetTransport(profile,fetcher), anchor=await finalBlock();
    const parsed=Transaction.safeParse(await rpc('EXPERIMENTAL_tx_status',{tx_hash:ref.txHash,sender_account_id:ref.from,wait_until:'FINAL'}));
    if (!parsed.success) return {kind:'NOT_VERIFIED',reason:'MISMATCH'};
    const t=parsed.data, root=z.strictObject({SuccessReceiptId:HashSchema}).safeParse(t.transaction_outcome.outcome.status);
    const ids=t.receipts_outcome.map(r=>r.id);
    const first=root.success?t.receipts_outcome.find(r=>r.id===root.data.SuccessReceiptId):undefined;
    if (new Set(ids).size!==ids.length || !root.success || !first || t.transaction.hash!==ref.txHash || t.transaction_outcome.id!==ref.txHash ||
      t.transaction.signer_id!==ref.from || t.transaction.receiver_id!==ref.to || t.transaction.actions[0]?.Transfer.deposit!==ref.amountYocto ||
      t.transaction_outcome.outcome.executor_id!==ref.from || !t.transaction_outcome.outcome.receipt_ids.includes(first.id) ||
      first.outcome.executor_id!==ref.to || !Success.safeParse(first.outcome.status).success) return {kind:'NOT_VERIFIED',reason:'MISMATCH'};
    const block=BlockSchema.parse(await rpc('block',{block_id:first.block_hash}));
    const sent=BlockSchema.parse(await rpc('block',{block_id:t.transaction_outcome.block_hash}));
    if (block.hash!==first.block_hash || sent.hash!==t.transaction_outcome.block_hash || BigInt(block.height)>BigInt(anchor.height) ||
      BigInt(sent.height)>BigInt(block.height) || BigInt(sent.timestampNs)>BigInt(block.timestampNs)) return {kind:'NOT_VERIFIED',reason:'MISMATCH'};
    return {kind:'VERIFIED',network:'near-mainnet',transactionHash:ref.txHash,from:ref.from,to:ref.to,amountYocto:ref.amountYocto,
      blockHash:block.hash,blockTimestampNs:block.timestampNs,trustModel:'configured-rpc'};
  } catch(e) {
    return {kind:'NOT_VERIFIED',reason:e instanceof NearClientError && e.code==='TRANSACTION_UNKNOWN'?'NOT_FOUND':'UNAVAILABLE'};
  }
}
