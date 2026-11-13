import type {MainnetPendingTransaction} from './mainnet-reconciliation.js';
import type {MainnetWalletAuthority} from './mainnet-wallet-v2.js';
import {HashSchema} from './validation.js';

/** Internal execution sequencing only. Contains no key, network client or gate
 * override. Production callers must already have passed their signing gates and
 * reserved a reconstructed operation. Tests supply inert handoff callbacks. */
export async function executeReservedMainnetHandoff(authority:Pick<MainnetWalletAuthority,'handoff'|'uncertain'>,
  attempt:MainnetPendingTransaction,prepare:()=>Promise<{transactionHash:string|null;send():Promise<string>}>) {
  let pending=attempt,hash:string|null=null;
  try {
    const prepared=await prepare();hash=prepared.transactionHash===null?null:HashSchema.parse(prepared.transactionHash);
    pending=await authority.handoff(attempt,hash);
    const returned=HashSchema.parse(await prepared.send());
    if(hash!==null&&hash!==returned)throw Error('TRANSACTION_HASH_CHANGED');
    hash=returned;
  }catch{/* Every post-reservation error is uncertain, including wallet rejection. */}
  try{await authority.uncertain(pending,hash);}catch{/* Preserve the last durable fence. */}
  return {kind:'OUTCOME_UNRESOLVED' as const,transactionHash:hash};
}
