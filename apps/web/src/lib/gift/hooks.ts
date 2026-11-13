'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createGiftReader } from '@taply/near-client';
import type { GiftConfig, GiftReader, GiftView } from '@taply/near-client';
import { FLAGS } from '@/lib/flags/features';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { giftGate, resolveGiftSetup } from './setup';
import type { GiftGate, GiftSetup } from './setup';

/** Build-time Open Gift setup (off until the gift contract is deployed and approved). */
export const GIFT_SETUP: GiftSetup = resolveGiftSetup({
  flag: FLAGS.giftClaimable.enabled,
  contractId: process.env.NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID,
  codeHash: process.env.NEXT_PUBLIC_TAPLY_GIFT_CODE_HASH,
  forbidden: [process.env.NEXT_PUBLIC_TAPLY_CONTRACT_ID, process.env.NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID],
});

let cached: GiftReader | null | undefined;
export function defaultGiftReader(setup: GiftSetup = GIFT_SETUP): GiftReader | null {
  if (cached !== undefined && setup === GIFT_SETUP) return cached;
  let reader: GiftReader | null = null;
  if (setup.status === 'ready' && CHAIN_CONFIG.ok) {
    try {
      reader = createGiftReader({ ...CHAIN_CONFIG.client, contract: { accountId: setup.contractId, expectedCodeHash: setup.expectedCodeHash } });
    } catch {
      reader = null;
    }
  }
  if (setup === GIFT_SETUP) cached = reader;
  return reader;
}

export type GiftContractCheck =
  | { readonly status: 'checking' }
  | { readonly status: 'unreachable' }
  | { readonly status: 'verified'; readonly config: GiftConfig; readonly gate: GiftGate; readonly observedAtNs: string };

/** Reads and gates the gift contract's config; `ensureFresh` re-reads right before signing. */
export function useGiftContract(setup: GiftSetup, reader: GiftReader | null) {
  const [check, setCheck] = useState<GiftContractCheck>({ status: 'checking' });
  const read = useCallback(async (): Promise<GiftContractCheck> => {
    if (reader === null) return { status: 'unreachable' };
    const r = await reader.readConfig().catch(() => null);
    if (r === null || r.error !== null || r.observation.data === null || r.observation.observedBlock === null) return { status: 'unreachable' };
    return { status: 'verified', config: r.observation.data, gate: giftGate(setup, r.observation.data), observedAtNs: r.observation.observedBlock.timestampNs };
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
    return next.status === 'verified' && next.gate.allowed ? next : null;
  }, [read]);
  return { check, ensureFresh };
}

export type GiftRead =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ok'; readonly gift: GiftView | null; readonly observedAtNs: string; readonly blockHeight: string };

/** True once nothing about the gift can change any more. */
export function giftSettled(gift: GiftView | null): boolean {
  return gift !== null && gift.payout === 'CONFIRMED';
}

/**
 * Polls `get_gift` at final blocks: every 3 s while something may still change,
 * and when the tab becomes visible again. Stops polling when a payout is
 * CONFIRMED. A failed read keeps the last good one only if it was settled;
 * otherwise the screen says "verification unavailable".
 */
export function useGift(id: string, reader: GiftReader | null, intervalMs = 3_000) {
  const [read, setRead] = useState<GiftRead>({ status: 'loading' });
  const last = useRef<GiftRead>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    if (reader === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no reader: a fixed, honest state
      setRead({ status: 'error' });
      return;
    }
    void reader.readGift(id).then(
      (r) => {
        if (!active) return;
        const block = r.observation.observedBlock;
        const next: GiftRead = r.error === null && r.observation.data !== null && block !== null
          ? { status: 'ok', gift: r.observation.data.gift, observedAtNs: r.observation.data.observedAtNs, blockHeight: block.height }
          : last.current.status === 'ok' && giftSettled(last.current.gift) ? last.current : { status: 'error' };
        last.current = next;
        setRead(next);
      },
      () => {
        if (active) setRead({ status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [id, reader, tick]);
  const settled = read.status === 'ok' && giftSettled(read.gift);
  useEffect(() => {
    if (settled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [settled, intervalMs, refresh]);
  return { read, refresh };
}
