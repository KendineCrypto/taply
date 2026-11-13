'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createMainnetReader } from '@taply/near-client';
import { MAINNET_CONFIG } from './config';
import { fixtureById } from './fixtures';
import type { MainnetRequest } from './fixtures';
import type { OneClickStatus } from './status';

/**
 * Browser reads for the mainnet build. Every chain read goes through
 * @taply/near-client's mainnet reader (genesis + pinned code hash at a final
 * block). In fixture mode the clearly labelled fixtures replace the chain.
 * No read is ever retried into a payment; polling only refreshes the view.
 */
export type RequestRead =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ok'; readonly request: MainnetRequest; readonly readAtMs: number; readonly fixture: boolean };

export const POLL_MS = 6_000;

export function readerOrNull() {
  return MAINNET_CONFIG.ok && MAINNET_CONFIG.profile !== null ? createMainnetReader(MAINNET_CONFIG.profile) : null;
}

export function useMainnetRequest(id: string, poll: boolean): { read: RequestRead; refresh: () => void } {
  const [snapshot, setSnapshot] = useState<{ id: string; read: RequestRead } | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    let sequence = 0;
    const run = async () => {
      const current = ++sequence;
      const setRead = (read: RequestRead) => {
        if (live && current === sequence) setSnapshot({ id, read });
      };
      if (MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures) {
        const entry = fixtureById(id, Date.now());
        if (live) setRead(entry === null ? { kind: 'not_found' } : { kind: 'ok', request: entry.request, readAtMs: Date.now(), fixture: true });
        return;
      }
      const reader = readerOrNull();
      if (reader === null) {
        if (live) setRead({ kind: 'disabled' });
        return;
      }
      try {
        const r = await reader.readRequest(id);
        if (!live) return;
        setRead(r.data === null ? { kind: 'not_found' } : { kind: 'ok', request: r.data, readAtMs: Date.now(), fixture: false });
      } catch {
        // An unavailable read cannot silently remain a current payable/paid
        // assertion, especially after navigation to another request.
        setRead({ kind: 'error' });
      }
    };
    void run();
    const timer = poll ? setInterval(() => void run(), POLL_MS) : null;
    return () => {
      live = false;
      if (timer !== null) clearInterval(timer);
    };
  }, [id, poll, tick]);

  return { read: snapshot?.id === id ? snapshot.read : { kind: 'loading' }, refresh };
}

export interface HintState {
  readonly status: OneClickStatus | null;
  readonly sinceMs: number;
  readonly refundTo: string | null;
  readonly originTxs: ReadonlyArray<{ readonly hash: string; readonly url: string | null }>;
  readonly nearTxs: ReadonlyArray<{ readonly hash: string; readonly url: string | null }>;
  readonly refundedAmountFormatted: string | null;
}

/** Polls the server status endpoint. A hint only: it never sets a paid state by itself. */
export function useOneClickHint(requestId: string, enabled: boolean): HintState | null {
  const [snapshot, setSnapshot] = useState<{ id: string; hint: HintState } | null>(null);
  const firstSeen = useRef<{ id: string; status: OneClickStatus | null; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const run = async () => {
      try {
        const res = await fetch(`/api/mainnet/oneclick/status?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as {
          hint: OneClickStatus | null;
          refundTo: string;
          originTxs: HintState['originTxs'];
          nearTxs: HintState['nearTxs'];
          refundedAmountFormatted: string | null;
        };
        if (!live) return;
        if (firstSeen.current?.id !== requestId || firstSeen.current.status !== body.hint) firstSeen.current = { id: requestId, status: body.hint, at: Date.now() };
        setSnapshot({ id: requestId, hint: {
          status: body.hint,
          sinceMs: firstSeen.current.at,
          refundTo: body.refundTo || null,
          originTxs: body.originTxs,
          nearTxs: body.nearTxs,
          refundedAmountFormatted: body.refundedAmountFormatted,
        } });
      } catch {
        // offline or service down: keep the last hint; the contract read is what matters
      }
    };
    void run();
    const timer = setInterval(() => void run(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [requestId, enabled]);

  return enabled && snapshot?.id === requestId ? snapshot.hint : null;
}

export type Registration = 'registered' | 'not_registered' | 'unknown' | 'fixture_registered';

const FIXTURES_ON = MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures;

export function useUsdcRegistration(accountId: string | null): Registration {
  const [state, setState] = useState<{ readonly accountId: string; readonly value: Registration } | null>(null);
  useEffect(() => {
    if (accountId === null || FIXTURES_ON) return;
    const reader = readerOrNull();
    if (reader === null) return;
    let live = true;
    reader
      .readUsdcStorage(accountId)
      .then((r) => live && setState({ accountId, value: r.data === null ? 'not_registered' : 'registered' }))
      .catch(() => live && setState({ accountId, value: 'unknown' }));
    return () => {
      live = false;
    };
  }, [accountId]);
  if (accountId === null) return 'unknown';
  if (FIXTURES_ON) return 'fixture_registered';
  return state !== null && state.accountId === accountId ? state.value : 'unknown';
}
