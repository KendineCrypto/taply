import { protectedConfigProblems } from '@taply/near-client';
import type { ProtectedConfigProblem, ProtectedContractConfig } from '@taply/near-client';
import { resolveContractSetting } from '@/lib/near/config';

/**
 * Protected Pay (G3 candidate) setup. Fail closed at every step:
 *
 *  1. the `protectedPay` flag (default OFF, security gate),
 *  2. a SEPARATE contract id + approved code hash (never the G1 pilot, which
 *     cannot hold escrow),
 *  3. a verified `get_config` read whose only allowed problem is
 *     UNREVIEWED_CANDIDATE, and only when this build explicitly says it is a
 *     protected QA build (`NEXT_PUBLIC_TAPLY_PROTECTED_QA=on`).
 *
 * Production sets none of these, so Protected Pay can only ever render its
 * "not enabled" explanation there.
 */
export const PILOT_CONTRACT_ID = 'taply-pay-pilot-1.testnet';

export type ProtectedSetup =
  | { readonly status: 'flag_off' }
  | { readonly status: 'not_configured' }
  | { readonly status: 'invalid' }
  | { readonly status: 'pilot_refused' }
  | { readonly status: 'ready'; readonly contractId: string; readonly expectedCodeHash: string; readonly qaBuild: boolean };

export function resolveProtectedSetup(input: {
  readonly flag: boolean;
  readonly contractId: string | undefined;
  readonly codeHash: string | undefined;
  readonly qa: string | undefined;
}): ProtectedSetup {
  if (!input.flag) return { status: 'flag_off' };
  const setting = resolveContractSetting(input.contractId, input.codeHash);
  if (setting.status === 'not_configured') return { status: 'not_configured' };
  if (setting.status === 'invalid') return { status: 'invalid' };
  if (setting.accountId === PILOT_CONTRACT_ID) return { status: 'pilot_refused' };
  return { status: 'ready', contractId: setting.accountId, expectedCodeHash: setting.expectedCodeHash, qaBuild: input.qa === 'on' };
}

export type ProtectedSigningGate =
  | { readonly allowed: true; readonly unreviewed: boolean }
  | { readonly allowed: false; readonly problems: ReadonlyArray<ProtectedConfigProblem> };

/** Signing is allowed only when the verified config has no problems a QA build may not waive. */
export function protectedSigningGate(setup: ProtectedSetup, config: ProtectedContractConfig): ProtectedSigningGate {
  if (setup.status !== 'ready') return { allowed: false, problems: [] };
  const problems = protectedConfigProblems(config, setup.contractId);
  const waivable = setup.qaBuild ? problems.filter((p) => p !== 'UNREVIEWED_CANDIDATE') : problems;
  if (waivable.length > 0) return { allowed: false, problems: waivable };
  return { allowed: true, unreviewed: problems.includes('UNREVIEWED_CANDIDATE') };
}
