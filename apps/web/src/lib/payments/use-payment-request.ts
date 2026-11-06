'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockRef } from '@/lib/protocol';
import { useAccountId } from '@/lib/wallet/provider';
import { usePayments } from './context';
import type { PaymentsReader } from './context';
import { buildPaymentView } from './intent';
import { isInFlight } from './map-chain-state';
import { liveWatchDelayMs, shouldLiveWatch } from '@/lib/merchant/journey';
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
 *
 * Phase 7F live watch (opt-in): the RECEIVER of a request that is OPEN and
 * still payable at the observed final block re-reads every 5 s (15 s after
 * ten minutes), so a merchant showing the sale QR sees the payment arrive
 * without touching the screen. Same read, same authority; it stops by itself
 * once the request leaves OPEN or its funding deadline passes.
 *
 * Concurrency (Phase 5C):
 *  - At most one read is in flight. A refresh requested meanwhile is queued, and
 *    exactly one more read (with the LATEST id/account/reader) runs when the
 *    current one settles, so a newer request is never silently skipped.
 *  - Each result is tagged with the id, account and reader it was read for and
 *    is only shown while those are still current. Switching request A -> B or
 *    payer account never paints A's (or the old role's) view.
 *  - After unmount nothing is applied and no queued read starts.
 */

export interface PaymentRequestState {
  readonly view: PaymentView | null;
  readonly loading: boolean;
  readonly checkedAt: string | null;
  readonly block: BlockRef | null;
}

interface Tag {
  readonly id: string;
  readonly accountId: string | null;
  readonly reader: PaymentsReader | null;
  readonly contractId: string | null;
}

interface Tagged extends PaymentRequestState {
  readonly tag: Tag;
}

const FIRST_DELAY_MS = 4_000;
const MAX_DELAY_MS = 20_000;

const sameTag = (a: Tag, b: Tag) =>
  a.id === b.id && a.accountId === b.accountId && a.reader === b.reader && a.contractId === b.contractId;

export function usePaymentRequest(
  id: string,
  /** Extra reason to poll, e.g. this browser has an unexplained attempt. */
  watchAttempt: boolean,
  options: { readonly liveWatchOpen?: boolean } = {},
): PaymentRequestState & { readonly refresh: () => void; readonly watching: boolean; readonly live: boolean } {
  const { setup } = usePayments();
  const accountId = useAccountId();
  const ready = setup.status === 'ready' ? setup : null;
  const current: Tag = { id, accountId, reader: ready?.reader ?? null, contractId: ready?.contractId ?? null };

  const [stored, setStored] = useState<Tagged | null>(null);
  const [loadingTag, setLoadingTag] = useState<Tag | null>(null);

  // The latest parameters, readable from async callbacks without re-subscribing.
  const latest = useRef<Tag>(current);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const mounted = useRef(false);
  const startRef = useRef<() => void>(() => undefined);

  const start = useCallback(() => {
    const tag = latest.current;
    if (tag.reader === null || tag.contractId === null) return;
    const reader = tag.reader;
    const contractId = tag.contractId;
    inFlight.current = true;
    setLoadingTag(tag);
    const finish = () => {
      inFlight.current = false;
      if (!mounted.current) return;
      if (queued.current) {
        queued.current = false;
        startRef.current();
      } else {
        setLoadingTag(null);
      }
    };
    reader
      .readPaymentRequest(tag.id)
      .then(
        (read) => {
          // Parameters changed while reading: this result belongs to someone else.
          if (!mounted.current || !sameTag(tag, latest.current)) return;
          setStored({
            tag,
            view: buildPaymentView({ read, expectedContractId: contractId, accountId: tag.accountId }),
            loading: false,
            checkedAt: read.observation.checkedAt,
            block: read.observation.observedBlock,
          });
        },
        () => {
          if (!mounted.current || !sameTag(tag, latest.current)) return;
          setStored({ tag, view: { kind: 'unavailable', error: null }, loading: false, checkedAt: null, block: null });
        },
      )
      .finally(finish);
  }, []);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const refresh = useCallback(() => {
    if (!mounted.current) return;
    if (inFlight.current) {
      // Never drop it: one more read runs with the newest parameters afterwards.
      queued.current = true;
      return;
    }
    start();
  }, [start]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queued.current = false;
    };
  }, []);

  // Initial read, and again whenever the request, account (role) or reader changes.
  const { reader, contractId } = current;
  useEffect(() => {
    latest.current = { id, accountId, reader, contractId };
    refresh();
  }, [id, accountId, reader, contractId, refresh]);

  const matches = stored !== null && sameTag(stored.tag, current);
  const view = matches ? stored.view : null;
  const settling = view?.kind === 'ok' && isInFlight(view.request.status);
  const live =
    options.liveWatchOpen === true &&
    view?.kind === 'ok' &&
    shouldLiveWatch({
      status: view.request.status,
      callerRole: view.response.derived.callerRole,
      observedAtNs: view.observedAtNs,
      fundingExpiresAtNs: view.request.terms.fundingExpiresAtNs,
    });
  const watch = watchAttempt || settling || live;
  // Live-only watching keeps a steady cadence; any other reason uses the backoff.
  const steady = live && !watchAttempt && !settling;

  useEffect(() => {
    if (!watch) return;
    const started = Date.now();
    let delay = steady ? liveWatchDelayMs(0) : FIRST_DELAY_MS;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') refresh();
      delay = steady ? liveWatchDelayMs(Date.now() - started) : Math.min(delay * 1.5, MAX_DELAY_MS);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [watch, steady, refresh]);

  // Back in the foreground: re-read once, so a status that changed while the
  // tab was hidden (or a skipped poll) is caught up immediately.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const loading = loadingTag !== null && sameTag(loadingTag, current);
  return {
    view,
    loading: loading || (!matches && ready !== null),
    checkedAt: matches ? stored.checkedAt : null,
    block: matches ? stored.block : null,
    refresh,
    watching: watch,
    live,
  };
}
