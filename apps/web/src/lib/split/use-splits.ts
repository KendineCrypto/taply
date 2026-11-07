'use client';

import { useCallback, useEffect, useState } from 'react';
import { SPLIT_STORAGE_KEY, loadSplits, recordChild, saveSplits } from './split';
import type { LoadedSplits, SplitGroup, SplitStorage } from './split';

const CHANGED_EVENT = 'taply-split-changed';

export function browserSplitStorage(): SplitStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function useSplits(storage: SplitStorage | null = browserSplitStorage()) {
  const [state, setState] = useState<LoadedSplits | null>(null);
  useEffect(() => {
    const reload = () => setState(loadSplits(storage));
    reload();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === SPLIT_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGED_EVENT, reload);
    };
  }, [storage]);

  const mutate = useCallback(
    (change: (list: SplitGroup[]) => SplitGroup[] | null): boolean => {
      const fresh = loadSplits(storage);
      if (fresh.status !== 'ok') return false;
      const next = change(fresh.groups);
      if (next === null || !saveSplits(storage, next)) return false;
      setState({ status: 'ok', groups: next });
      window.dispatchEvent(new Event(CHANGED_EVENT));
      return true;
    },
    [storage],
  );
  return { state, groups: state?.status === 'ok' ? state.groups : [], mutate };
}

/** Links one participant's share to the request created for it (see lib/tools/prefill-context). */
export function recordSplitChild(groupId: string, participantId: string, requestId: string, now: Date, storage = browserSplitStorage()): boolean {
  const fresh = loadSplits(storage);
  if (fresh.status !== 'ok') return false;
  const group = fresh.groups.find((g) => g.id === groupId);
  if (group === undefined) return false;
  const result = recordChild(group, participantId, requestId, now);
  if (!result.ok) return false;
  if (!saveSplits(storage, fresh.groups.map((g) => (g.id === groupId ? result.group : g)))) return false;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
  return true;
}
