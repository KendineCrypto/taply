import { giftConfigProblems } from '@taply/near-client';
import type { GiftConfig, GiftConfigProblem } from '@taply/near-client';
import { resolveContractSetting } from '@/lib/near/config';

/**
 * Taply Gift (Open / claimable) setup. Fail closed at every step:
 *  1. the `giftClaimable` flag (default OFF, security gate),
 *  2. a SEPARATE contract id + approved code hash, never the Instant Pay
 *     pilot or the Protected Pay escrow,
 *  3. a verified `get_config` read whose only allowed problem is
 *     UNREVIEWED_CANDIDATE (the contract has had no human review; test NEAR only).
 */
export const PILOT_CONTRACT_ID = 'taply-pay-pilot-1.testnet';

export type GiftSetup =
  | { readonly status: 'flag_off' }
  | { readonly status: 'not_configured' }
  | { readonly status: 'invalid' }
  | { readonly status: 'refused' }
  | { readonly status: 'ready'; readonly contractId: string; readonly expectedCodeHash: string };

export function resolveGiftSetup(input: {
  readonly flag: boolean;
  readonly contractId: string | undefined;
  readonly codeHash: string | undefined;
  /** Contracts that must never be treated as the gift contract. */
  readonly forbidden: ReadonlyArray<string | undefined>;
}): GiftSetup {
  if (!input.flag) return { status: 'flag_off' };
  const setting = resolveContractSetting(input.contractId, input.codeHash);
  if (setting.status === 'not_configured') return { status: 'not_configured' };
  if (setting.status === 'invalid') return { status: 'invalid' };
  if (setting.accountId === PILOT_CONTRACT_ID || input.forbidden.includes(setting.accountId)) return { status: 'refused' };
  return { status: 'ready', contractId: setting.accountId, expectedCodeHash: setting.expectedCodeHash };
}

export type GiftGate =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly problems: ReadonlyArray<GiftConfigProblem> };

export function giftGate(setup: GiftSetup, config: GiftConfig): GiftGate {
  if (setup.status !== 'ready') return { allowed: false, problems: [] };
  const problems = giftConfigProblems(config, setup.contractId, setup.contractId).filter((p) => p !== 'UNREVIEWED_CANDIDATE');
  return problems.length === 0 ? { allowed: true } : { allowed: false, problems };
}
