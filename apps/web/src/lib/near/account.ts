import { AccountIdSchema } from '@/lib/protocol';

/**
 * What an account ID string says about its network, from syntax alone.
 *
 * Syntax never proves existence, ownership or network (API.md). This exists
 * only to catch the obvious mistake early - a wallet handing back a mainnet
 * `.near` name - before an RPC read reports it as not found on Testnet. The
 * authoritative check is still the Testnet RPC read itself.
 */
export type AccountNetworkHint =
  | 'testnet_named'
  | 'implicit'
  | 'eth_implicit'
  | 'likely_mainnet'
  | 'other_named'
  | 'invalid';

const NEAR_IMPLICIT = /^[0-9a-f]{64}$/;
const ETH_IMPLICIT = /^0x[0-9a-f]{40}$/;

export function classifyAccountId(accountId: string): AccountNetworkHint {
  if (!AccountIdSchema.safeParse(accountId).success) return 'invalid';
  if (NEAR_IMPLICIT.test(accountId)) return 'implicit';
  if (ETH_IMPLICIT.test(accountId)) return 'eth_implicit';
  if (accountId === 'testnet' || accountId.endsWith('.testnet')) return 'testnet_named';
  if (accountId === 'near' || accountId.endsWith('.near')) return 'likely_mainnet';
  return 'other_named';
}

/**
 * True only when the ID is syntactically unusable. A `.near` name is NOT
 * rejected: the top-level `near` account exists on Testnet too (observed via
 * Testnet RPC on 2026-10-29), so only the Testnet read can say whether it is
 * wrong. `likely_mainnet` is surfaced as a warning instead.
 */
export function isRejectedAccount(hint: AccountNetworkHint): boolean {
  return hint === 'invalid';
}

/** Short form for chrome only. Decision points always show the full ID. */
export function shortAccountId(accountId: string): string {
  return accountId.length > 20 ? `${accountId.slice(0, 8)}…${accountId.slice(-8)}` : accountId;
}
