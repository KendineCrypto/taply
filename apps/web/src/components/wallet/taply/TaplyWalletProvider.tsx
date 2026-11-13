'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { VaultError, WalletEngineError } from '@taply/near-client';
import type { LocalWalletIdentity, WalletBalanceSnapshot, WalletTransactionReview } from '@taply/near-client';
import type { Dictionary } from '@/lib/i18n';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { WalletError, WalletNotDispatchedError } from '@/lib/wallet/adapter';
import type { SignOutcome, WalletCall, WalletErrorKind, WalletSession } from '@/lib/wallet/adapter';
import { WalletOverride } from '@/lib/wallet/provider';
import type { WalletValue } from '@/lib/wallet/provider';
import { ConfirmTransactionDialog, UnlockDialog } from './TaplyDialogs';
import { useWalletMode } from './mode';
import { PROTECTED_SETUP } from '@/lib/protected/hooks';
import { GIFT_SETUP } from '@/lib/gift/hooks';
import { createTaplyWalletController, TaplyNameTakenError, TaplyPhraseMismatchError } from '@/lib/wallet/taply-wallet';

/**
 * React bridge to the Codex-owned Taply Wallet controller
 * (lib/wallet/taply-wallet.ts). This file holds UI state only:
 *  - every key operation (generate, encrypt, unlock, lock, backup, restore)
 *    is a controller call; nothing cryptographic happens here;
 *  - only the ENCRYPTED backup string ever passes through (for download);
 *  - signing (NEAR Testnet, owner decision 2026-11-09) happens only inside the
 *    controller, after the ConfirmTransactionDialog shows the exact reviewed
 *    transaction and the person presses Confirm;
 *  - when Taply Wallet is the active wallet (mode "taply"), every screen that
 *    uses useWallet() (payments, requests, swaps) gets this wallet instead of
 *    the external connector, through WalletOverride;
 *  - a LOCAL_ONLY identity is never presented as an on-chain account; a named
 *    `username.testnet` counts only after a FINAL read shows it holds the key.
 *
 */

export type TaplyWalletController = ReturnType<typeof createTaplyWalletController>;
export type TaplyErrorCode = keyof Dictionary['walletNative']['errors'];
export type TaplyResult<T = void> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: TaplyErrorCode };

export type TaplyWalletState =
  /** Insecure context, missing Web Crypto/Web Locks or invalid chain config. */
  | { readonly status: 'unavailable' }
  | { readonly status: 'checking' }
  | { readonly status: 'not_created' }
  /** `nameTaken`: the named account exists on chain under another key. */
  | { readonly status: 'local_only'; readonly identity: LocalWalletIdentity; readonly nameTaken?: true }
  /** Identity exists but NEAR Testnet could not be read. Never treated as provisioned. */
  | { readonly status: 'unknown'; readonly identity: LocalWalletIdentity }
  | { readonly status: 'provisioned'; readonly identity: LocalWalletIdentity; readonly balance: WalletBalanceSnapshot };

type PreparedTransfer = Awaited<ReturnType<TaplyWalletController['prepareSend']>>;
export type SendOutcome =
  | { readonly kind: 'final'; readonly transactionHash: string; readonly succeeded: boolean }
  | { readonly kind: 'unknown'; readonly transactionHash: string | null }
  | { readonly kind: 'declined' };

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
  /** FINAL read: is `accountId` still free on NEAR Testnet? */
  readonly checkAvailable: (accountId: string) => Promise<TaplyResult<boolean>>;
  /** Local encrypted vault bound to a named `*.testnet` account (nothing on chain yet). */
  readonly createNamed: (passphrase: string, accountId: string) => Promise<TaplyResult<LocalWalletIdentity>>;
  /** Testnet faucet + FINAL confirmation. ok only when the account holds this key. */
  readonly activate: () => Promise<TaplyResult<LocalWalletIdentity>>;
  /** Same key, another free name; only while the current name is not on chain. */
  readonly rebindName: (passphrase: string, accountId: string) => Promise<TaplyResult<LocalWalletIdentity>>;
  /** The 12-word recovery phrase, after the password is checked. */
  readonly revealPhrase: (passphrase: string) => Promise<TaplyResult<readonly string[]>>;
  /** Import a recovery phrase (named account verified on chain first). */
  readonly restorePhrase: (phrase: string, passphrase: string, accountId?: string) => Promise<TaplyResult<LocalWalletIdentity>>;
  /** Read-only review (exact reserves) before sending. */
  readonly prepareSend: (receiverId: string, amountNear: string) => Promise<TaplyResult<PreparedTransfer>>;
  /** Native NEAR transfer: unlock if needed, reviewed backend, confirmation dialog, one send, FINAL. */
  readonly sendNear: (receiverId: string, amountNear: string) => Promise<TaplyResult<SendOutcome>>;
}

const KNOWN: ReadonlySet<string> = new Set([
  'BAD_PASSWORD_OR_DATA', 'PASSWORD_POLICY', 'ALREADY_EXISTS', 'INVALID_RECORD', 'STORAGE_UNAVAILABLE',
  'CRYPTO_UNAVAILABLE', 'CANCELLED', 'LOCKED', 'ACCOUNT_NOT_PROVISIONED', 'INVALID_ADDRESS', 'INVALID_AMOUNT',
  'INSUFFICIENT_AVAILABLE_BALANCE', 'NETWORK_MISMATCH', 'RPC_UNAVAILABLE', 'INVALID_ACCOUNT_ID', 'INVALID_PHRASE', 'NO_RECOVERY_PHRASE',
]);

/** Maps controller errors to UI copy keys. Messages from errors are never shown. */
export function taplyErrorCode(error: unknown): TaplyErrorCode {
  if ((error instanceof VaultError || error instanceof WalletEngineError) && KNOWN.has(error.code)) {
    return error.code as TaplyErrorCode;
  }
  if (error instanceof TaplyNameTakenError) return 'NAME_TAKEN';
  if (error instanceof TaplyPhraseMismatchError) return error.reason === 'ACCOUNT_NOT_FOUND' ? 'PHRASE_ACCOUNT_NOT_FOUND' : 'PHRASE_NOT_FOR_ACCOUNT';
  if (error instanceof WalletError) return error.kind === 'unavailable' ? 'UNAVAILABLE' : 'UNKNOWN';
  return 'UNKNOWN';
}

type Confirm = (review: WalletTransactionReview) => Promise<boolean>;

function defaultFactory(confirmTransaction: Confirm): TaplyWalletController | null {
  if (!CHAIN_CONFIG.ok) return null;
  try {
    return createTaplyWalletController({ config: CHAIN_CONFIG.client, storage: window.localStorage, confirmTransaction,
      // The escrow candidate is unreviewed: the wallet signs for it only on a build that says so explicitly.
      protectedContract: PROTECTED_SETUP.status === 'ready' && PROTECTED_SETUP.qaBuild
        ? { accountId: PROTECTED_SETUP.contractId, expectedCodeHash: PROTECTED_SETUP.expectedCodeHash } : null,
      // Open Gifts: only when this build pins an approved gift contract (flag + id + code hash).
      giftContract: GIFT_SETUP.status === 'ready' ? { accountId: GIFT_SETUP.contractId, expectedCodeHash: GIFT_SETUP.expectedCodeHash } : null });
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
  readonly factory?: (confirmTransaction: Confirm) => TaplyWalletController | null;
}) {
  const [pendingReview, setPendingReview] = useState<{ review: WalletTransactionReview; resolve: (ok: boolean) => void } | null>(null);
  const [unlockRequest, setUnlockRequest] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const confirmTransaction = useCallback<Confirm>(
    (review) => new Promise<boolean>((resolve) => setPendingReview({ review, resolve })),
    [],
  );
  const [controller, setController] = useState<TaplyWalletController | null | undefined>(undefined);
  const [state, setState] = useState<TaplyWalletState>({ status: 'checking' });
  const [unlocked, setUnlocked] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Created on the client only (it needs window, Web Crypto and storage).
  useEffect(() => {
    const created = factory(confirmTransaction);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client initialisation
    setController(created);
    if (created === null) return;
    const unsubscribe = created.adapter.subscribe((session) => {
      if (session === null) setUnlocked(false);
    });
    // Stay unlocked across page loads: restore the persisted session (no password).
    void created.resume().then(
      () => setUnlocked(created.unlocked),
      () => setUnlocked(false),
    );
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
  }, [factory, confirmTransaction]);

  useEffect(() => {
    if (controller === undefined || controller === null) return;
    let active = true;
    void controller.read().then(
      (read) => {
        if (!active) return;
        if (read.status === 'NOT_CREATED') setState({ status: 'not_created' });
        else if (read.status === 'LOCAL_ONLY')
          setState(read.nameTaken ? { status: 'local_only', identity: read.identity, nameTaken: true } : { status: 'local_only', identity: read.identity });
        else setState({ status: 'provisioned', identity: read.identity, balance: read.balance });
      },
      () => {
        if (!active) return;
        // The identity is local; only the chain read failed. A background
        // refresh that fails keeps the last FINAL balance instead of blanking it.
        let identity: LocalWalletIdentity | null = null;
        try {
          identity = controller.receive().identity;
        } catch {
          identity = null;
        }
        setState((current) =>
          identity === null
            ? { status: 'not_created' }
            : current.status === 'provisioned' && current.identity.accountId === identity.accountId
              ? current
              : { status: 'unknown', identity },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [controller, generation]);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  // Keep the balance current: every 20 s while visible, and when the page
  // becomes visible again (payments change it outside this provider).
  useEffect(() => {
    if (!controller) return;
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const timer = setInterval(tick, 20_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [controller, refresh]);

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
      async checkAvailable(accountId) {
        if (!controller) return missing;
        try {
          return { ok: true, value: await controller.isAccountAvailable(accountId) };
        } catch (error) {
          const code = taplyErrorCode(error);
          return { ok: false, code: code === 'UNKNOWN' ? 'RPC_UNAVAILABLE' : code };
        }
      },
      async createNamed(passphrase, accountId) {
        if (!controller) return missing;
        try {
          const identity = await controller.createNamed(passphrase, accountId);
          refresh();
          return { ok: true, value: identity };
        } catch (error) {
          return { ok: false, code: taplyErrorCode(error) };
        }
      },
      async activate() {
        if (!controller) return missing;
        try {
          const outcome = await controller.activate();
          refresh();
          if (outcome.status === 'ON_CHAIN') return { ok: true, value: outcome.identity };
          if (outcome.status === 'NAME_TAKEN') return { ok: false, code: 'NAME_TAKEN' };
          if (outcome.status === 'PENDING') return { ok: false, code: 'PROVISIONING_PENDING' };
          return {
            ok: false,
            code: outcome.reason === 'rate_limited' ? 'FAUCET_RATE_LIMITED' : outcome.reason === 'rejected' ? 'FAUCET_REJECTED' : 'FAUCET_UNAVAILABLE',
          };
        } catch (error) {
          const code = taplyErrorCode(error);
          return { ok: false, code: code === 'UNKNOWN' ? 'RPC_UNAVAILABLE' : code };
        }
      },
      async rebindName(passphrase, accountId) {
        if (!controller) return missing;
        try {
          const identity = await controller.rebindName(passphrase, accountId);
          setUnlocked(false);
          refresh();
          return { ok: true, value: identity };
        } catch (error) {
          return { ok: false, code: taplyErrorCode(error) };
        }
      },
      async revealPhrase(passphrase) {
        if (!controller) return missing;
        try {
          return { ok: true, value: await controller.revealRecoveryPhrase(passphrase) };
        } catch (error) {
          return { ok: false, code: taplyErrorCode(error) };
        }
      },
      async restorePhrase(phrase, passphrase, accountId) {
        if (!controller) return missing;
        try {
          const identity = await controller.restoreFromRecoveryPhrase(phrase, passphrase, accountId);
          refresh();
          return { ok: true, value: identity };
        } catch (error) {
          const code = taplyErrorCode(error);
          return { ok: false, code: code === 'UNKNOWN' ? 'RPC_UNAVAILABLE' : code };
        }
      },
      async sendNear(receiverId, amountNear) {
        if (!controller) return missing;
        try {
          if (!controller.unlocked) {
            const ok = await new Promise<boolean>((resolve) => setUnlockRequest({ resolve }));
            if (!ok) return { ok: true, value: { kind: 'declined' } };
          }
          const review = await controller.prepareTransactionReview(receiverId, amountNear);
          const result = await controller.confirmAndSend(review.id);
          refresh();
          return { ok: true, value: result.kind === 'final'
            ? { kind: 'final', transactionHash: result.transactionHash, succeeded: result.outcome === 'SUCCEEDED' }
            : { kind: 'unknown', transactionHash: result.transactionHash } };
        } catch (error) {
          if (error instanceof WalletEngineError && error.code === 'REVIEW_REJECTED') return { ok: true, value: { kind: 'declined' } };
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

  const [mode] = useWalletMode();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [lastError, setLastError] = useState<WalletErrorKind | null>(null);
  const [connecting, setConnecting] = useState(false);

  // A lock (Lock now, expiry, another tab) ends the payment session too.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror the vault lock
    if (!unlocked && session !== null) setSession(null);
  }, [unlocked, session]);

  // When Taply Wallet is the active wallet and already unlocked, connect it
  // without a tap (the account must be confirmed on chain; the adapter checks).
  const provisioned = state.status === 'provisioned';
  useEffect(() => {
    if (mode !== 'taply' || !controller || !unlocked || !provisioned || session !== null) return;
    let alive = true;
    void controller.adapter.connect().then(
      (next) => {
        if (alive) setSession(next);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [mode, controller, unlocked, provisioned, session]);

  const override = useMemo<WalletValue | null>(() => {
    if (mode !== 'taply') return null;
    if (!controller) return { state: { status: 'disabled' }, connect: async () => {}, disconnect: async () => {}, dismissError: () => {},
      signAndSend: async () => { throw new WalletNotDispatchedError(); } };
    const active = unlocked ? session : null;
    const connectNow = async () => {
      try {
        const next = await controller.adapter.connect();
        setSession(next);
        setLastError(null);
      } catch (error) {
        setSession(null);
        setLastError(error instanceof WalletError ? error.kind : 'failed');
      }
    };
    return {
      state: active !== null ? { status: 'connected', session: active } : connecting ? { status: 'connecting' } : { status: 'disconnected', lastError },
      async connect() {
        setConnecting(true);
        try {
          if (!controller.unlocked) {
            const ok = await new Promise<boolean>((resolve) => setUnlockRequest({ resolve }));
            if (!ok) {
              setLastError('cancelled');
              return;
            }
          }
          await connectNow();
        } finally {
          setConnecting(false);
        }
      },
      async disconnect() {
        controller.lock();
        setUnlocked(false);
        setSession(null);
      },
      dismissError: () => setLastError(null),
      async signAndSend(call: WalletCall): Promise<SignOutcome> {
        if (active === null || !controller.connected) throw new WalletNotDispatchedError();
        try {
          return await controller.adapter.signAndSendTransaction(active.accountId, call);
        } finally {
          // The backend returns after FINAL: re-read the balance now.
          refresh();
        }
      },
    };
  }, [mode, controller, unlocked, session, connecting, lastError, refresh]);

  return (
    <TaplyWalletContext.Provider value={value}>
      <WalletOverride value={override}>{children}</WalletOverride>
      {unlockRequest !== null && (
        <UnlockDialog
          onCancel={() => {
            unlockRequest.resolve(false);
            setUnlockRequest(null);
          }}
          onUnlock={async (password) => {
            const result = await value.unlock(password);
            if (!result.ok) return result.code;
            unlockRequest.resolve(true);
            setUnlockRequest(null);
            return null;
          }}
        />
      )}
      {pendingReview !== null && (
        <ConfirmTransactionDialog
          review={pendingReview.review}
          onDecide={(approved) => {
            pendingReview.resolve(approved);
            setPendingReview(null);
          }}
        />
      )}
    </TaplyWalletContext.Provider>
  );
}

export function useTaplyWallet(): TaplyWalletValue {
  const value = useContext(TaplyWalletContext);
  if (value === null) throw new Error('useTaplyWallet must be used inside <TaplyWalletProvider>');
  return value;
}

/** Same as useTaplyWallet, but null outside the provider (screens that may render without it). */
export function useOptionalTaplyWallet(): TaplyWalletValue | null {
  return useContext(TaplyWalletContext);
}
