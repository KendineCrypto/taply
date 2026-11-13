'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { NearConnector } from '@hot-labs/near-connect';
import { classifyWalletError } from '@/lib/wallet/adapter';
import { MAINNET_CONFIG } from './config';
import { mainnetConnectorOptions, pageCspNonce } from './wallet-config';

/**
 * Mainnet external-wallet session. Connect, restore and disconnect only.
 * Deliberately exposes no signing function: MAINNET_SIGNING_RELEASE_APPROVED
 * is false, and the Testnet adapter/vault are never mounted in this build.
 */
export type MainnetWalletStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type MainnetWalletError = 'unavailable' | 'failed' | 'rejected' | 'testnet_account';

interface MainnetWalletValue {
  readonly status: MainnetWalletStatus;
  readonly accountId: string | null;
  readonly walletName: string | null;
  readonly error: MainnetWalletError | null;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
}

const Ctx = createContext<MainnetWalletValue | null>(null);

/** A mainnet session must never carry a Testnet account. */
export function acceptMainnetAccount(accountId: unknown): string | null {
  if (typeof accountId !== 'string' || !/^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(accountId)) return null;
  if (accountId === 'testnet' || accountId.endsWith('.testnet')) return null;
  return accountId;
}

export function MainnetWalletProvider({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<MainnetWalletStatus>('idle');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [error, setError] = useState<MainnetWalletError | null>(null);
  const connector = useRef<Promise<NearConnector> | null>(null);
  const rpcUrl = MAINNET_CONFIG.ok ? MAINNET_CONFIG.rpcUrl : null;

  const getConnector = useCallback(() => {
    if (rpcUrl === null) return Promise.reject(new Error('no wallet'));
    connector.current ??= import('@hot-labs/near-connect').then(({ NearConnector: C }) => new C(mainnetConnectorOptions(rpcUrl, pageCspNonce())));
    connector.current.catch(() => (connector.current = null));
    return connector.current;
  }, [rpcUrl]);

  const adopt = useCallback((accounts: ReadonlyArray<{ accountId: string }> | undefined, name: string) => {
    const raw = accounts?.[0]?.accountId;
    const ok = acceptMainnetAccount(raw);
    if (ok === null) {
      setError(typeof raw === 'string' && raw.endsWith('.testnet') ? 'testnet_account' : 'failed');
      setStatus('error');
      return;
    }
    setAccountId(ok);
    setWalletName(name);
    setError(null);
    setStatus('connected');
  }, []);

  useEffect(() => {
    let live = true;
    getConnector()
      .then((c) => c.getConnectedWallet())
      .then(({ wallet, accounts }) => live && adopt(accounts, wallet.manifest.name))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [getConnector, adopt]);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError(null);
    try {
      const c = await getConnector();
      await c.whenManifestLoaded;
      if (c.availableWallets.length === 0) throw new Error('no wallet');
      const wallet = await c.connect();
      adopt(await wallet.getAccounts({ network: 'mainnet' }), wallet.manifest.name);
    } catch (cause) {
      const kind = classifyWalletError(cause);
      setError(kind === 'cancelled' ? 'rejected' : kind === 'unavailable' ? 'unavailable' : 'failed');
      setStatus('error');
    }
  }, [getConnector, adopt]);

  const disconnect = useCallback(async () => {
    try {
      await (await getConnector()).disconnect();
    } catch {
      // already disconnected
    }
    setAccountId(null);
    setWalletName(null);
    setStatus('idle');
  }, [getConnector]);

  const value = useMemo(() => ({ status, accountId, walletName, error, connect, disconnect }), [status, accountId, walletName, error, connect, disconnect]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMainnetWallet(): MainnetWalletValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMainnetWallet must be used inside <MainnetWalletProvider>');
  return v;
}
