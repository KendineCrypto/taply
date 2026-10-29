'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** Browser connectivity. Assumed online during the server render. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export type CopyStatus = 'idle' | 'copied' | 'failed';

/** Copies text, reporting the outcome for ~2s. Never throws into render. */
export function useCopy(): { readonly status: CopyStatus; readonly copy: (text: string) => void } {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback((text: string) => {
    const settle = (next: CopyStatus) => {
      setStatus(next);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus('idle'), 2000);
    };
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      settle('failed');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => settle('copied'),
      () => settle('failed'),
    );
  }, []);

  return { status, copy };
}
