'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockRef } from '@/lib/protocol';
import { useAccountId } from '@/lib/wallet/provider';
import { usePayments } from './context';
import { buildPaymentView } from './intent';
import { isInFlight } from './map-chain-state';
import type { PaymentView } from './intent';

/**
 * Read-only status synchronisation for one request.
 *
 * Every refresh is a new finalized-block read of `get_request` through
 * near-client (code hash checked at that block). Nothing else - no socket, no
 * wallet result, no local journal - can change what this returns.
 *
 * Polling is a convenience, not an authority: it runs only while an outgoing
 * transfer may still settle or this browser has an unexplained attempt, and
 * only while the tab is visible. It backs off from 4 s to 20 s and never
 * triggers any transaction.
 */

export interface PaymentRequestState {
  readonly view: PaymentView | null;
  readonly loading: boolean;
  readonly checkedAt: string | null;
  readonly block: BlockRef | null;
}

const FIRST_DELAY_MS = 4_000;
const MAX_DELAY_MS = 20_000;

export function usePaymentRequest(
  id: string,
  /** Extra reason to poll, e.g. this browser has an unexplained attempt. */
  watchAttempt: boolean,
): PaymentRequestState & { readonly refresh: () => void; readonly watching: boolean } {
  const { setup } = usePayments();
  const accountId = useAccountId();
  const [state, setState] = useState<PaymentRequestState>({ view: null, loading: false, checkedAt: null, block: null });
  const inFlight = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    if (setup.status !== 'ready' || inFlight.current) return;
    inFlight.current = true;
    const mine = ++generation.current;
    setState((s) => ({ ...s, loading: true }));
    setup.reader
      .readPaymentRequest(id)
      .then((read) => {
        if (mine !== generation.current) return;
        setState({
          view: buildPaymentView({ read, expectedContractId: setup.contractId, accountId }),
          loading: false,
          checkedAt: read.observation.checkedAt,
          block: read.observation.observedBlock,
        });
      })
      .catch(() => {
        if (mine === generation.current) setState((s) => ({ ...s, view: { kind: 'unavailable', error: null }, loading: false }));
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [setup, id, accountId]);

  // Initial read, and again whenever the connected account changes (role changes).
  useEffect(() => {
    refresh();
  }, [refresh]);

  const view = state.view;
  const watch = watchAttempt || (view?.kind === 'ok' && isInFlight(view.request.status));

  useEffect(() => {
    if (!watch) return;
    let delay = FIRST_DELAY_MS;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') refresh();
      delay = Math.min(delay * 1.5, MAX_DELAY_MS);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [watch, refresh]);

  return { ...state, refresh, watching: watch };
}
