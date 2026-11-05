'use client';

import { useEffect, useState } from 'react';
import type { ContractRequest } from '@/lib/protocol';
import { locateFundingTransaction } from './locate-funding';
import type { LocateResult } from './locate-funding';
import type { LocatorRpc } from './rpc';

export type LocatorView =
  /** Not needed (a reference is already known) or not possible in this build. */
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | Exclude<LocateResult, { readonly kind: 'not_applicable' }>
  | Extract<LocateResult, { readonly kind: 'not_applicable' }>;

/**
 * Phase 7G: runs the read-only funding locator once for a paid request whose
 * funding hash this device does not have. Waits while the tab is hidden, so a
 * background tab spends no RPC budget. In memory only: nothing is stored, and a
 * reload searches again (the chain, not a cache, decides).
 */
export function useFundingLocator(input: {
  readonly rpc: LocatorRpc | null;
  readonly contractId: string;
  readonly request: ContractRequest | null;
  /** False when a funding reference is already known or still being matched. */
  readonly enabled: boolean;
  readonly generation: number;
}): LocatorView {
  const { rpc, contractId, request, enabled, generation } = input;
  const key =
    enabled && rpc !== null && request !== null && request.status === 'FINAL_PAID'
      ? JSON.stringify([rpc.providerId, contractId, request.terms.id, request.termsHash, request.fundedAtNs, request.latestOperation?.nonce, generation])
      : null;
  const [result, setResult] = useState<{ key: string; view: LocatorView } | null>(null);

  useEffect(() => {
    if (key === null || rpc === null || request === null) return;
    let active = true;
    let waiting = false;
    const run = async () => {
      if (!active) return;
      if (document.visibilityState === 'hidden') {
        waiting = true;
        return;
      }
      waiting = false;
      const outcome = await locateFundingTransaction({ rpc, contractId, request });
      if (active) setResult({ key, view: outcome });
    };
    const onVisible = () => {
      if (waiting && document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    void run();
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // `key` captures the provider, contract, request terms/funding facts and generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (key === null) return { kind: 'idle' };
  if (result === null || result.key !== key) return { kind: 'searching' };
  return result.view;
}
