'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { NearConnector } from '@hot-labs/near-connect';
import { createMainnetWalletKeyProof } from '@taply/near-client';
import type { MainnetNearConnectWallet } from '@taply/near-client';
import { classifyWalletError } from '@/lib/wallet/adapter';
import { MAINNET_CONFIG } from './config';
import { mainnetConnectorOptions, pageCspNonce } from './wallet-config';

/**
 * Mainnet external-wallet session: connect, restore, disconnect, and the
 * reported account public key. `signerWallet()` hands the connected wallet ONLY
 * to Codex's createMainnetWalletBackend (lib/mainnet/wallet-ops.ts), whose submit
 * is closed while MAINNET_PROTOCOL_SIGNING_RELEASED is false. Wallets that omit their key can provide it through an explicit, verified
 * NEP-413 connection proof. Transaction-time FullAccess checks stay in the backend.
 * The Testnet adapter/vault are never mounted in this build.
 */
export type MainnetWalletStatus = 'idle' | 'connecting' | 'connected' | 'error';
export type MainnetWalletError = 'unavailable' | 'failed' | 'rejected' | 'testnet_account';

interface MainnetWalletValue {
  readonly status: MainnetWalletStatus;
  readonly accountId: string | null;
  readonly walletName: string | null;
  readonly error: MainnetWalletError | null;
  /** Public key the wallet reported for this account (ed25519:...), or null if it reports none. */
  readonly publicKey: string | null;
  readonly signerWallet: () => MainnetNearConnectWallet | null;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly verifyKey: () => Promise<void>;
}

/** The subset of a NEAR Connect wallet the unified backend uses. */
interface ExternalWallet {
  getAccounts(o: { network: 'mainnet' }): Promise<ReadonlyArray<{ accountId: string; publicKey?: string }>>;
  signAndSendTransaction(params: unknown): Promise<unknown>;
  signMessage(params: unknown): Promise<unknown>;
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
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const walletRef = useRef<MainnetNearConnectWallet | null>(null);
  const rawWalletRef = useRef<ExternalWallet | null>(null);
  const generation = useRef(0);
  const proofRef = useRef<{ accountId: string; publicKey: string } | null>(null);
  const connector = useRef<Promise<NearConnector> | null>(null);
  const rpcUrl = MAINNET_CONFIG.ok ? MAINNET_CONFIG.rpcUrl : null;

  const getConnector = useCallback(() => {
    if (rpcUrl === null) return Promise.reject(new Error('no wallet'));
    connector.current ??= import('@hot-labs/near-connect').then(({ NearConnector: C }) => new C(mainnetConnectorOptions(rpcUrl, pageCspNonce())));
    connector.current.catch(() => (connector.current = null));
    return connector.current;
  }, [rpcUrl]);

  const adopt = useCallback((accounts: ReadonlyArray<{ accountId: string; publicKey?: string }> | undefined, name: string, wallet?: ExternalWallet) => {
    generation.current++; proofRef.current = null; rawWalletRef.current = wallet ?? null;
    const raw = accounts?.[0]?.accountId;
    const key = accounts?.[0]?.publicKey;
    setPublicKey(typeof key === 'string' && /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key) ? key : null);
    walletRef.current = wallet ? {
      getAccounts: async () => (await wallet.getAccounts({ network: 'mainnet' })).map((a) => ({ accountId: a.accountId, ...(a.publicKey ? { publicKey: a.publicKey } : proofRef.current?.accountId === a.accountId ? { publicKey: proofRef.current.publicKey } : {}) })),
      signAndSendTransaction: (params) => wallet.signAndSendTransaction(params as never),
      // Used for the explicit connection proof and the reviewed authority flow; never a transaction.
      signMessage: (params: unknown) => wallet.signMessage(params) as Promise<{ accountId: string; publicKey: string; signature: string }>,
    } as MainnetNearConnectWallet : null;
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
      .then(({ wallet, accounts }) => live && adopt(accounts, wallet.manifest.name, wallet as unknown as ExternalWallet))
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
      adopt(await wallet.getAccounts({ network: 'mainnet' }), wallet.manifest.name, wallet as unknown as ExternalWallet);
    } catch (cause) {
      const kind = classifyWalletError(cause);
      setError(kind === 'cancelled' ? 'rejected' : kind === 'unavailable' ? 'unavailable' : 'failed');
      setStatus('error');
    }
  }, [getConnector, adopt]);

  const verifyKey = useCallback(async () => {
    const wallet = rawWalletRef.current, expected = accountId, version = generation.current;
    if (!wallet || !expected) throw Error('WALLET_DISCONNECTED');
    const proof = createMainnetWalletKeyProof(expected, window.location.origin);
    const result = await wallet.signMessage(proof.params);
    const key = await proof.accept(result);
    const accounts = await wallet.getAccounts({ network: 'mainnet' });
    if (version !== generation.current || wallet !== rawWalletRef.current || !accounts.some(a => a.accountId === expected && (!a.publicKey || a.publicKey === key))) throw Error('EXTERNAL_IDENTITY_MISMATCH');
    proofRef.current = { accountId: expected, publicKey: key };
    setPublicKey(key);
  }, [accountId]);

  const disconnect = useCallback(async () => {
    generation.current++; proofRef.current = null; rawWalletRef.current = null;
    try {
      await (await getConnector()).disconnect();
    } catch {
      // already disconnected
    }
    setAccountId(null);
    setWalletName(null);
    setPublicKey(null);
    walletRef.current = null;
    setStatus('idle');
  }, [getConnector]);

  const signerWallet = useCallback(() => walletRef.current, []);
  const value = useMemo(() => ({ status, accountId, walletName, error, publicKey, signerWallet, connect, disconnect, verifyKey }), [status, accountId, walletName, error, publicKey, signerWallet, connect, disconnect, verifyKey]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMainnetWallet(): MainnetWalletValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMainnetWallet must be used inside <MainnetWalletProvider>');
  return v;
}
