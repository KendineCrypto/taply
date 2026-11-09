'use client';

import '@/lib/security/zod-jitless';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { FLAGS } from '@/lib/flags/features';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { classifyWalletError } from './adapter';
import { WalletNotDispatchedError } from './adapter';
import type { SignOutcome, WalletAdapter, WalletCall, WalletErrorKind, WalletSession } from './adapter';
import { createNearConnectAdapter } from './near-connect';

export type WalletState =
  /** Flag off or chain config invalid: no wallet UI is offered at all. */
  | { readonly status: 'disabled' }
  /** Checking whether the wallet still has a session. Renders as a skeleton. */
  | { readonly status: 'restoring' }
  | { readonly status: 'disconnected'; readonly lastError: WalletErrorKind | null }
  | { readonly status: 'connecting' }
  | { readonly status: 'connected'; readonly session: WalletSession };

export interface WalletValue {
  readonly state: WalletState;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly dismissError: () => void;
  /**
   * Signs one prepared call as the CURRENTLY connected account. Callers must
   * have journaled the attempt first (lib/payments/submit.ts does).
   */
  readonly signAndSend: (call: WalletCall) => Promise<SignOutcome>;
}

const WalletContext = createContext<WalletValue | null>(null);

function defaultAdapter(): WalletAdapter | null {
  if (!FLAGS.walletConnect.enabled || !CHAIN_CONFIG.ok) return null;
  return createNearConnectAdapter(CHAIN_CONFIG.client.rpcUrl);
}

export function WalletProvider({
  children,
  adapter: injected,
}: {
  readonly children: ReactNode;
  /** Tests inject a fake; `null` forces the disabled state. */
  readonly adapter?: WalletAdapter | null;
}) {
  const [adapter] = useState<WalletAdapter | null>(() => (injected === undefined ? defaultAdapter() : injected));
  const [state, setState] = useState<WalletState>(() =>
    adapter === null ? { status: 'disabled' } : { status: 'restoring' },
  );

  useEffect(() => {
    if (adapter === null) return;
    let active = true;

    adapter
      .restore()
      .then((session) => {
        if (!active) return;
        setState((current) =>
          current.status !== 'restoring'
            ? current
            : session === null
              ? { status: 'disconnected', lastError: null }
              : { status: 'connected', session },
        );
      })
      .catch(() => {
        if (active) setState({ status: 'disconnected', lastError: null });
      });

    const unsubscribe = adapter.subscribe((session) => {
      if (!active) return;
      setState((current) => {
        // A connect() in progress reports its own outcome.
        if (current.status === 'connecting') return current;
        return session === null ? { status: 'disconnected', lastError: null } : { status: 'connected', session };
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [adapter]);

  const connect = useCallback(async () => {
    if (adapter === null) return;
    setState({ status: 'connecting' });
    try {
      const session = await adapter.connect();
      setState({ status: 'connected', session });
    } catch (cause) {
      setState({ status: 'disconnected', lastError: classifyWalletError(cause) });
    }
  }, [adapter]);

  const disconnect = useCallback(async () => {
    if (adapter === null) return;
    await adapter.disconnect();
    setState({ status: 'disconnected', lastError: null });
  }, [adapter]);

  const dismissError = useCallback(() => {
    setState((current) => (current.status === 'disconnected' ? { status: 'disconnected', lastError: null } : current));
  }, []);

  const signAndSend = useCallback(
    async (call: WalletCall): Promise<SignOutcome> => {
      if (adapter === null || state.status !== 'connected') throw new WalletNotDispatchedError();
      return adapter.signAndSendTransaction(state.session.accountId, call);
    },
    [adapter, state],
  );

  const value = useMemo<WalletValue>(
    () => ({ state, connect, disconnect, dismissError, signAndSend }),
    [state, connect, disconnect, dismissError, signAndSend],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletValue {
  const value = useContext(WalletContext);
  if (value === null) throw new Error('useWallet must be used inside <WalletProvider>');
  return value;
}

/** The connected account ID, or null. */
export function useAccountId(): string | null {
  const { state } = useWallet();
  return state.status === 'connected' ? state.session.accountId : null;
}

/**
 * Replaces the wallet for everything below it (Taply Wallet when it is the
 * active wallet). `null` keeps the outer (external) wallet.
 */
export function WalletOverride({ value, children }: { readonly value: WalletValue | null; readonly children: ReactNode }) {
  if (value === null) return <>{children}</>;
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
