import type { NativeBalance, ReadResult, RpcErrorCode } from '@taply/near-client';
import type { BlockRef } from '@/lib/protocol';

/**
 * Balance presentation model.
 *
 * The non-negotiable rule (CLAUDE.md, Phase 2A brief item 7): never display an
 * invented balance. So a number is shown ONLY when it came from a finalized
 * Testnet RPC read of the exact account asked about. Everything else - loading,
 * outage, mock source, mismatch - renders without digits, and an error is never
 * rendered as a zero balance.
 *
 * An outage after a good read keeps the last verified value, explicitly marked
 * stale with the time it was checked (near-client README "Trust and errors").
 */

export interface VerifiedBalance {
  readonly balance: NativeBalance;
  readonly observedBlock: BlockRef;
  readonly checkedAt: string;
}

export type BalanceView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | ({ readonly kind: 'verified' } & VerifiedBalance)
  | ({ readonly kind: 'stale'; readonly errorCode: RpcErrorCode } & VerifiedBalance)
  | { readonly kind: 'not_found' }
  | { readonly kind: 'network_mismatch' }
  | { readonly kind: 'unverified' }
  | { readonly kind: 'error'; readonly errorCode: RpcErrorCode };

/** Errors after which a previously verified value must NOT keep being shown. */
const DISCARDS_PREVIOUS: ReadonlySet<RpcErrorCode> = new Set<RpcErrorCode>([
  'ACCOUNT_NOT_FOUND',
  'NETWORK_MISMATCH',
  'EVIDENCE_MISMATCH',
  'INVALID_ARGUMENT',
  'INVALID_CONFIG',
]);

function previousVerified(view: BalanceView): VerifiedBalance | null {
  if (view.kind === 'verified' || view.kind === 'stale') {
    return { balance: view.balance, observedBlock: view.observedBlock, checkedAt: view.checkedAt };
  }
  return null;
}

export function nextBalanceView(
  previous: BalanceView,
  requestedAccountId: string,
  result: ReadResult<NativeBalance>,
): BalanceView {
  const { observation, error } = result;

  if (error !== null) {
    if (error.code === 'ACCOUNT_NOT_FOUND') return { kind: 'not_found' };
    if (error.code === 'NETWORK_MISMATCH') return { kind: 'network_mismatch' };

    const prior = previousVerified(previous);
    if (prior !== null && prior.balance.accountId === requestedAccountId && !DISCARDS_PREVIOUS.has(error.code)) {
      return { kind: 'stale', errorCode: error.code, ...prior };
    }
    return { kind: 'error', errorCode: error.code };
  }

  const data = observation.data;
  const trustworthy =
    observation.source === 'rpc' &&
    observation.assurance === 'verified_final' &&
    observation.rpcAvailable &&
    !observation.stale &&
    observation.observedBlock !== null &&
    data !== null &&
    data.accountId === requestedAccountId &&
    data.assetId === 'near:native';

  if (!trustworthy || data === null || observation.observedBlock === null) {
    return { kind: 'unverified' };
  }

  return {
    kind: 'verified',
    balance: data,
    observedBlock: observation.observedBlock,
    checkedAt: observation.checkedAt,
  };
}

/** The value to put on screen, or null. The only place a balance number leaves this module. */
export function displayableBalance(view: BalanceView): VerifiedBalance | null {
  return previousVerified(view);
}
