'use client';

import { useCallback, useEffect, useState } from 'react';
import { createProtectedReader } from '@taply/near-client';
import type { ProtectedContractConfig, ProtectedReader, RpcErrorCode } from '@taply/near-client';
import { FLAGS } from '@/lib/flags/features';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { chainFreshness } from '@/lib/payments/freshness';
import type { PaymentView } from '@/lib/payments/intent';
import { protectedSigningGate, resolveProtectedSetup } from './setup';
import type { ProtectedSetup, ProtectedSigningGate } from './setup';
import { buildProtectedView } from './view';

/** Build-time Protected Pay setup. Production sets none of these variables. */
export const PROTECTED_SETUP: ProtectedSetup = resolveProtectedSetup({
  flag: FLAGS.protectedPay.enabled,
  contractId: process.env.NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID,
  codeHash: process.env.NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH,
  qa: process.env.NEXT_PUBLIC_TAPLY_PROTECTED_QA,
});

let cachedReader: ProtectedReader | null | undefined;

/** The one Protected reader for this build, or null when setup or chain config is not usable. */
export function defaultProtectedReader(setup: ProtectedSetup = PROTECTED_SETUP): ProtectedReader | null {
  if (cachedReader !== undefined) return cachedReader;
  if (setup.status !== 'ready' || !CHAIN_CONFIG.ok) {
    cachedReader = null;
    return null;
  }
  try {
    cachedReader = createProtectedReader({
      ...CHAIN_CONFIG.client,
      contract: { accountId: setup.contractId, expectedCodeHash: setup.expectedCodeHash },
    });
  } catch {
    cachedReader = null;
  }
  return cachedReader;
}

export type ProtectedCheck =
  | { readonly status: 'checking' }
  | { readonly status: 'unreachable'; readonly error: RpcErrorCode | null }
  | {
      readonly status: 'verified';
      readonly config: ProtectedContractConfig;
      readonly gate: ProtectedSigningGate;
      /** Chain time of the block that verified the config. */
      readonly observedAtNs: string;
    };

/**
 * Reads and gates the candidate's config. `ensureFresh` re-reads it right
 * before any wallet prompt; a stale or unverifiable read returns null.
 */
export function useProtectedContract(setup: ProtectedSetup, reader: ProtectedReader | null, now: () => number = Date.now) {
  const [check, setCheck] = useState<ProtectedCheck>({ status: 'checking' });

  const read = useCallback(async (): Promise<ProtectedCheck> => {
    if (reader === null) return { status: 'unreachable', error: null };
    const result = await reader.readConfig().catch(() => null);
    if (result === null || result.error !== null || result.observation.data === null || result.observation.observedBlock === null) {
      return { status: 'unreachable', error: result?.error?.code ?? null };
    }
    const config = result.observation.data;
    return { status: 'verified', config, gate: protectedSigningGate(setup, config), observedAtNs: result.observation.observedBlock.timestampNs };
  }, [reader, setup]);

  useEffect(() => {
    let active = true;
    void read().then((next) => {
      if (active) setCheck(next);
    });
    return () => {
      active = false;
    };
  }, [read]);

  const ensureFresh = useCallback(async () => {
    const next = await read();
    setCheck(next);
    if (next.status !== 'verified' || chainFreshness(next.observedAtNs, now()) !== 'fresh') return null;
    return next;
  }, [read, now]);

  return { check, ensureFresh };
}

export interface ProtectedRequestState {
  readonly view: PaymentView | null;
  /** Device time (ms) when `view` arrived; for the indicative countdown only. */
  readonly receivedAtMs: number | null;
  readonly loading: boolean;
}

const POLL_MS = 8_000;

/**
 * Polls one Protected request while it can still change. Every result comes
 * from a code-hash-anchored final read; nothing is inferred between reads.
 */
export function useProtectedRequest(id: string, reader: ProtectedReader | null, contractId: string | null, accountId: string | null) {
  const [state, setState] = useState<ProtectedRequestState>({ view: null, receivedAtMs: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reader === null || contractId === null) return;
    // Cleanup flips `active`, so a result for an older id/account is dropped.
    let active = true;
    void reader.client
      .readPaymentRequest(id)
      .then(
        (read) => buildProtectedView({ read, expectedContractId: contractId, accountId }),
        (): PaymentView => ({ kind: 'unavailable', error: null }),
      )
      .then((view) => {
        if (!active) return;
        setState({ view, receivedAtMs: Date.now(), loading: false });
      });
    return () => {
      active = false;
    };
  }, [id, reader, contractId, accountId, tick]);

  const status = state.view?.kind === 'ok' ? state.view.request.status : null;
  const changing = status !== null && status !== 'FINAL_PAID' && status !== 'CANCELLED_REFUNDED' && status !== 'CANCELLED_UNFUNDED';
  useEffect(() => {
    if (!changing) return;
    const timer = setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => clearTimeout(timer);
  }, [changing, tick]);

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    setTick((n) => n + 1);
  }, []);

  return { ...state, refresh };
}
