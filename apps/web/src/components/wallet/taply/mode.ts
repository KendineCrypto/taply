'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Which wallet the home, receive and send screens show. A UI preference only:
 * it never grants signing, and Instant Pay always uses the external wallet.
 */
export type WalletMode = 'external' | 'taply';
export const WALLET_MODE_KEY = 'taply.wallet-mode.v1';
const EVENT = 'taply:wallet-mode';

function read(): WalletMode {
  try {
    return window.localStorage.getItem(WALLET_MODE_KEY) === 'taply' ? 'taply' : 'external';
  } catch {
    return 'external';
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useWalletMode(): readonly [WalletMode, (mode: WalletMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => 'external' as WalletMode);
  const set = useCallback((next: WalletMode) => {
    try {
      window.localStorage.setItem(WALLET_MODE_KEY, next);
    } catch {
      // Storage unavailable: the choice simply does not persist.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [mode, set] as const;
}
