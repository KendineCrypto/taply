'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { VaultError, WalletEngineError } from '@taply/near-client';
import type { LocalWalletIdentity, WalletBalanceSnapshot } from '@taply/near-client';
import type { Dictionary } from '@/lib/i18n';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { WalletError } from '@/lib/wallet/adapter';
import { createTaplyWalletController } from '@/lib/wallet/taply-wallet';

/**
 * React bridge to the Codex-owned Taply Wallet controller
 * (lib/wallet/taply-wallet.ts). This file holds UI state only:
 *  - every key operation (generate, encrypt, unlock, lock, backup, restore)
 *    is a controller call; nothing cryptographic happens here;
 *  - only the ENCRYPTED backup string ever passes through (for download);
 *  - signing is not reachable: the controller's signer is hard-disabled and
 *    this provider never offers a sign or submit action;
 *  - a LOCAL_ONLY identity is never presented as an on-chain account.
 *
 * It is separate from the payments WalletProvider on purpose: Instant Pay keeps
 * using the external (NEAR Connect / Meteor) wallet.
 */

export type TaplyWalletController = ReturnType<typeof createTaplyWalletController>;
export type TaplyErrorCode = keyof Dictionary['walletNative']['errors'];
export type TaplyResult<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: TaplyErrorCode };

export type TaplyWalletState =
  /** Insecure context, missing Web Crypto/Web Locks or invalid chain config. */
  | { readonly status: 'unavailable' }
  | { readonly status: 'checking' }
  | { readonly status: 'not_created' }
  | { readonly status: 'local_only'; readonly identity: LocalWalletIdentity }
  /** Identity exists but NEAR Testnet could not be read. Never treated as provisioned. */
  | { readonly status: 'unknown'; readonly identity: LocalWalletIdentity }
  | { readonly status: 'provisioned'; readonly identity: LocalWalletIdentity; readonly balance: WalletBalanceSnapshot };

type PreparedTransfer = Awaited<ReturnType<TaplyWalletController['prepareSend']>>;

interface TaplyWalletValue {
  readonly state: TaplyWalletState;
  readonly unlocked: boolean;
  readonly refresh: () => void;
  readonly create: (passphrase: string) => Promise<TaplyResult<LocalWalletIdentity>>;
  readonly unlock: (passphrase: string) => Promise<TaplyResult>;
  readonly lock: () => void;
  /** The encrypted vault record only. Never plaintext key material. */
  readonly exportEncryptedBackup: () => TaplyResult<string>;
  readonly restore: (backup: string, passphrase: string) => Promise<TaplyResult<LocalWalletIdentity>>;
  /** Read-only review. There is deliberately no sign/submit counterpart. */
  readonly prepareSend: (receiverId: string, amountNear: string) => Promise<TaplyResult<PreparedTransfer>>;
}

const KNOWN: ReadonlySet<string> = new Set([
  'BAD_PASSWORD_OR_DATA', 'PASSWORD_POLICY', 'ALREADY_EXISTS', 'INVALID_RECORD', 'STORAGE_UNAVAILABLE',
  'CRYPTO_UNAVAILABLE', 'CANCELLED', 'LOCKED', 'ACCOUNT_NOT_PROVISIONED', 'INVALID_ADDRESS', 'INVALID_AMOUNT',
  'INSUFFICIENT_AVAILABLE_BALANCE', 'NETWORK_MISMATCH', 'RPC_UNAVAILABLE',
]);

/** Maps controller errors to UI copy keys. Messages from errors are never shown. */
export function taplyErrorCode(error: unknown): TaplyErrorCode {
  if ((error instanceof VaultError || error instanceof WalletEngineError) && KNOWN.has(error.code)) {
    return error.code as TaplyErrorCode;
  }
  if (error instanceof WalletError) return error.kind === 'unavailable' ? 'UNAVAILABLE' : 'UNKNOWN';
  return 'UNKNOWN';
}

function defaultFactory(): TaplyWalletController | null {
  if (!CHAIN_CONFIG.ok) return null;
  try {
    return createTaplyWalletController({ config: CHAIN_CONFIG.client, storage: window.localStorage });
  } catch {
    return null;
  }
}

const TaplyWalletContext = createContext<TaplyWalletValue | null>(null);

export function TaplyWalletProvider({
  children,
  factory = defaultFactory,
}: {
  readonly children: ReactNode;
  /** Tests inject the real controller with a deterministic chain reader. */
  readonly factory?: () => TaplyWalletController | null;
}) {
  const [controller, setController] = useState<TaplyWalletController | null | undefined>(undefined);
  const [state, setState] = useState<TaplyWalletState>({ status: 'checking' });
  const [unlocked, setUnlocked] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Created on the client only (it needs window, Web Crypto and storage).
  useEffect(() => {
    const created = factory();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client initialisation
    setController(created);
    if (created === null) return;
    const unsubscribe = created.adapter.subscribe((session) => {
      if (session === null) setUnlocked(false);
    });
    // Catch expiry/locks from other tabs even if no event reached this tab.
    const timer = setInterval(() => {
      try {
        setUnlocked(created.unlocked);
      } catch {
        setUnlocked(false);
      }
    }, 10_000);
    return () => {
      clearInterval(timer);
      unsubscribe();
      created.dispose();
    };
  }, [factory]);

  useEffect(() => {
    if (controller === undefined || controller === null) return;
    let active = true;
    void controller.read().then(
      (read) => {
        if (!active) return;
        if (read.status === 'NOT_CREATED') setState({ status: 'not_created' });
        else if (read.status === 'LOCAL_ONLY') setState({ status: 'local_only', identity: read.identity });
        else setState({ status: 'provisioned', identity: read.identity, balance: read.balance });
      },
      () => {
        if (!active) return;
        // The identity is local; only the chain read failed.
        try {
          setState({ status: 'unknown', identity: controller.receive().identity });
        } catch {
          setState({ status: 'not_created' });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [controller, generation]);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  const value = useMemo<TaplyWalletValue>(() => {
    const missing = { ok: false as const, code: 'UNAVAILABLE' as const };
    return {
      state: controller === null ? { status: 'unavailable' } : state,
      unlocked,
      refresh,
      async create(passphrase) {
        if (!controller) return missing;
        try {
          const identity = await controller.create(passphrase);
          refresh();
          return { ok: true, value: identity };
        } catch (error) {
          return { ok: false, code: taplyErrorCode(error) };
        }
      },
      async unlock(passphrase) {
        if (!controller) return missing;
        try {
          await controller.unlock(passphrase);
          setUnlocked(controller.unlocked);
          return { ok: true, value: undefined };
        } catch (error) {
          setUnlocked(false);
          return { ok: false, code: taplyErrorCode(error) };
        }
      },
      lock() {
        controller?.lock();
        setUnlocked(false);
      },
      exportEncryptedBackup() {
        if (!controller) return missing;
        try {
          return { ok: true, value: controller.exportEncryptedBackup() };
        } catch (error) {
          return { ok: false, code: taplyErrorCode(error) };
        }
      },
      async restore(backup, passphrase) {
        if (!controller) return missing;
        try {
          const identity = await controller.restoreEncryptedBackup(backup, passphrase);
          refresh();
          return { ok: true, value: identity };
        } catch (error) {
          return { ok: false, code: taplyErrorCode(error) };
        }
      },
      async prepareSend(receiverId, amountNear) {
        if (!controller) return missing;
        try {
          return { ok: true, value: await controller.prepareSend(receiverId, amountNear) };
        } catch (error) {
          return { ok: false, code: taplyErrorCode(error) };
        }
      },
    };
  }, [controller, state, unlocked, refresh]);

  return <TaplyWalletContext.Provider value={value}>{children}</TaplyWalletContext.Provider>;
}

export function useTaplyWallet(): TaplyWalletValue {
  const value = useContext(TaplyWalletContext);
  if (value === null) throw new Error('useTaplyWallet must be used inside <TaplyWalletProvider>');
  return value;
}
