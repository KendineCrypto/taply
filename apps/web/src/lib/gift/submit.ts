import type { PreparedGiftCall } from '@taply/near-client';
import { WalletDeclinedError, WalletNotDispatchedError, WalletNotSentError } from '@/lib/wallet/adapter';
import type { SignOutcome, WalletCall } from '@/lib/wallet/adapter';

/**
 * One gift transaction through the connected wallet. The result says only what
 * the WALLET reported; screens follow up with a final `get_gift` read.
 *
 * No journal is needed for safety here: every gift call is idempotent on chain
 * (a create re-uses its pre-chosen gift id -> GIFT_ID_TAKEN; a second claim or
 * refund -> ALREADY_SETTLED; a retry needs a recorded failure), so repeating an
 * unknown attempt can never move money twice. Taply Wallet additionally blocks
 * a new signature until its last unknown attempt is explained by the chain.
 */
export type GiftSubmit =
  | { readonly kind: 'submitted'; readonly transactionHash: string }
  | { readonly kind: 'unknown'; readonly transactionHash: string | null }
  | { readonly kind: 'declined' }
  | { readonly kind: 'not_sent' };

export async function submitGiftCall(signAndSend: (call: WalletCall) => Promise<SignOutcome>, call: PreparedGiftCall): Promise<GiftSubmit> {
  let outcome: SignOutcome;
  try {
    outcome = await signAndSend({ receiverId: call.receiverId, methodName: call.methodName, args: call.args, gas: call.gas, depositYocto: call.depositYocto });
  } catch (error) {
    if (error instanceof WalletDeclinedError) return { kind: 'declined' };
    if (error instanceof WalletNotSentError || error instanceof WalletNotDispatchedError) return { kind: 'not_sent' };
    return { kind: 'unknown', transactionHash: null };
  }
  return outcome.kind === 'submitted' ? outcome : { kind: 'unknown', transactionHash: outcome.transactionHash ?? null };
}
