'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nextBalanceView } from './balance';
import type { BalanceView } from './balance';
import type { NearTestnetClient } from './client';

interface Stored {
  readonly accountId: string;
  readonly view: BalanceView;
  readonly refreshing: boolean;
}

/**
 * Reads the native NEAR balance of `accountId` from Testnet RPC.
 *
 * - One read on mount / account change, one on `refresh()`, and one when the tab
 *   becomes visible again. No background polling: balances are informational
 *   here, and the public RPC is rate limited.
 * - Stored state is tagged with the account it belongs to, and a result for an
 *   account that is no longer selected is dropped, so a slow read can never
 *   paint someone else's balance.
 * - Reads never retry automatically (near-client has no timeout retries either).
 * - Overlapping reads for the SAME account and client are coalesced: a trigger
 *   within JOIN_WINDOW_MS of the in-flight read joins it; a later one (e.g. a
 *   refresh after a payment, or the resume read after an interruption) is
 *   queued so exactly one follow-up read runs when the current one settles.
 *   A different account or client never joins: its read starts at once and the
 *   old result is dropped. Balances are never cached across accounts/providers.
 */

/** Triggers this close to an in-flight read share its result. */
export const JOIN_WINDOW_MS = 1_000;

interface InFlight {
  readonly client: Pick<NearTestnetClient, 'readNativeBalance'>;
  readonly accountId: string;
  readonly startedAt: number;
  /** Generation it was started in; a read from an older generation is never joined. */
  readonly ticket: number;
  /** A trigger arrived after the join window: read once more when this settles. */
  again: boolean;
}
export function useNativeBalance(
  client: Pick<NearTestnetClient, 'readNativeBalance'> | null,
  accountId: string | null,
): { readonly view: BalanceView; readonly refreshing: boolean; readonly refresh: () => void } {
  const [stored, setStored] = useState<Stored | null>(null);
  /** Bumped when the account/client changes or the hook unmounts: older results are dropped. */
  const generation = useRef(0);
  const inFlight = useRef<InFlight | null>(null);

  /** Performs (or joins) a read. Only touches state after the await, never synchronously. */
  const read = useCallback(async () => {
    if (client === null || accountId === null) return;
    const running = inFlight.current;
    if (
      running !== null &&
      running.client === client &&
      running.accountId === accountId &&
      running.ticket === generation.current
    ) {
      if (Date.now() - running.startedAt > JOIN_WINDOW_MS) running.again = true;
      return;
    }
    const ticket = generation.current;
    const run = async (): Promise<void> => {
      const mine: InFlight = { client, accountId, startedAt: Date.now(), ticket, again: false };
      inFlight.current = mine;
      let result: Awaited<ReturnType<NearTestnetClient['readNativeBalance']>> | null = null;
      try {
        result = await client.readNativeBalance(accountId);
      } catch {
        // near-client returns errors as values; a throw is unexpected. Fail closed.
      }
      if (inFlight.current === mine) inFlight.current = null;
      // Account or client changed (or unmounted) meanwhile: not ours to show.
      if (ticket !== generation.current) return;
      setStored((prev) => {
        const previous = prev !== null && prev.accountId === accountId ? prev.view : ({ kind: 'loading' } as const);
        const view: BalanceView =
          result === null
            ? { kind: 'error', errorCode: 'RPC_MALFORMED_RESPONSE' }
            : nextBalanceView(previous, accountId, result);
        return { accountId, view, refreshing: mine.again };
      });
      if (mine.again) await run();
    };
    await run();
  }, [client, accountId]);

  /** User-initiated refresh: shows the spinner immediately, keeps the current value visible. */
  const refresh = useCallback(() => {
    if (client === null || accountId === null) return;
    setStored((prev) => (prev !== null && prev.accountId === accountId ? { ...prev, refreshing: true } : prev));
    void read();
  }, [client, accountId, read]);

  useEffect(() => {
    if (accountId === null) return;
    void read();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      generation.current += 1;
    };
  }, [accountId, read]);

  if (accountId === null) return { view: { kind: 'idle' }, refreshing: false, refresh: () => undefined };
  if (client === null) {
    // Invalid chain configuration: say so, never fall back to another endpoint.
    return { view: { kind: 'error', errorCode: 'INVALID_CONFIG' }, refreshing: false, refresh: () => undefined };
  }
  if (stored === null || stored.accountId !== accountId) {
    return { view: { kind: 'loading' }, refreshing: true, refresh };
  }
  return { view: stored.view, refreshing: stored.refreshing, refresh };
}
