'use client';

import { useCallback, useEffect, useState } from 'react';
import { createMainnetGiftReader } from '@taply/near-client';
import { GIFT_PROFILE } from './gift-profile';
import { POLL_MS } from './hooks';

type GiftResponse = Awaited<ReturnType<ReturnType<typeof createMainnetGiftReader>['readGift']>>;
export type GiftRead = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' }
  | { kind: 'ok'; data: NonNullable<GiftResponse['data']>; config: GiftResponse['config']; nowNs: string };

/** FINAL reads only. Polling never signs, retries a payout, or infers settlement. */
export function useMainnetGift(id: string) {
  const [snapshot, setSnapshot] = useState<{ id: string; read: GiftRead } | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    if (GIFT_PROFILE === null) return;
    let live = true, sequence = 0;
    const reader = createMainnetGiftReader(GIFT_PROFILE);
    const run = async () => {
      const current = ++sequence;
      const commit = (read: GiftRead) => { if (live && current === sequence) setSnapshot({ id, read }); };
      try {
        const r = await reader.readGift(id);
        commit(r.data === null ? { kind: 'missing' } : { kind: 'ok', data: r.data, config: r.config, nowNs: r.timestampNs });
      } catch { commit({ kind: 'error' }); }
    };
    void run();
    const timer = setInterval(() => void run(), POLL_MS);
    const resume = () => { if (document.visibilityState === 'visible') void run(); };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [id, tick]);
  return { read: snapshot?.id === id ? snapshot.read : { kind: 'loading' } as GiftRead, refresh };
}
