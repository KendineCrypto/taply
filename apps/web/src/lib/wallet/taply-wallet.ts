import {
  EncryptedTestnetVault, WalletEngineError, createWalletChain, ed25519PublicKeyFromHex,
  prepareNativeNearTransfer, VAULT_STORAGE_KEY, createReviewedWalletBackend,
} from '@taply/near-client';
import type { LocalWalletIdentity, NearTestnetConfig, VaultStorage, WalletBalanceSnapshot, WalletChain, WalletTransactionReview, PreparedContractCall } from '@taply/near-client';
import { encodeQr } from '@/lib/qr/encode';
import { FLAGS } from '@/lib/flags/features';
import { WalletError } from './adapter';
import type { WalletAdapter, WalletSession } from './adapter';

/** Human security review + an independently tested SDK signer are prerequisites.
 * No env, query parameter, vault unlock or UI action can enable this constant.
 */
export const TAPLY_WALLET_SIGNING_ENABLED = false as const;

export type TaplyWalletRead =
  | { readonly status: 'NOT_CREATED' }
  | { readonly status: 'LOCAL_ONLY'; readonly identity: LocalWalletIdentity }
  | { readonly status: 'PROVISIONED'; readonly identity: LocalWalletIdentity; readonly balance: WalletBalanceSnapshot };

/** Library integration seam only. Default WalletProvider remains external/Meteor.
 * No UI, account creation, funding or automatic migration of an external wallet.
 */
export function createTaplyWalletController(input: {
  readonly config: NearTestnetConfig;
  readonly storage: VaultStorage;
  readonly crypto?: Crypto;
  /** Deterministic read-only test seam; production uses createWalletChain. */
  readonly chain?: WalletChain;
  readonly confirmTransaction?: (review: WalletTransactionReview) => Promise<boolean>;
}) {
  if (typeof window === 'undefined' || globalThis.isSecureContext !== true) throw new WalletError('unavailable');
  const vault = new EncryptedTestnetVault(input.storage, input.crypto ? { crypto: input.crypto } : {});
  const configuredChain = createWalletChain(input.config); // validate config even with a test reader
  const chain = input.chain ?? configuredChain;
  const listeners = new Set<(session: WalletSession | null) => void>();
  let connected = false;
  const notifyLocked = () => { connected = false; for (const listener of listeners) listener(null); };
  const unsubscribe = vault.subscribe(notifyLocked);
  const hidden = () => { if (document.visibilityState !== 'visible') vault.lock(); };
  const pagehide = () => vault.lock();
  const storageChanged = (event: StorageEvent) => { if (event.key === VAULT_STORAGE_KEY || event.key === null) vault.lock(); };
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', pagehide);
  window.addEventListener('storage', storageChanged);
  const withVaultWriteLock = async <T>(task: () => Promise<T>): Promise<T> => {
    if (!navigator.locks) throw new WalletError('unavailable');
    return navigator.locks.request('taply.testnet-vault-write.v1', { mode: 'exclusive' }, task);
  };
  const backend = createReviewedWalletBackend({ config: input.config, vault, storage: input.storage, chain,
    ...(input.crypto ? { crypto: input.crypto } : {}),
    policy: { signingPermitted: () => TAPLY_WALLET_SIGNING_ENABLED, contractCallsPermitted: () => FLAGS.instantPay.enabled,
      withExclusiveLock: withVaultWriteLock } });

  const read = async (): Promise<TaplyWalletRead> => {
    const identity = vault.getIdentity();
    if (identity === null) return { status: 'NOT_CREATED' };
    const balance = await chain.snapshot(identity.accountId, ed25519PublicKeyFromHex(identity.publicKeyHex));
    return balance === null ? { status: 'LOCAL_ONLY', identity } : { status: 'PROVISIONED', identity, balance };
  };
  const session = async (): Promise<WalletSession | null> => {
    if (!vault.unlocked) return null;
    const value = await read();
    if (value.status !== 'PROVISIONED' || !vault.unlocked) return null;
    return { accountId: value.identity.accountId, walletId: 'taply-local-testnet', walletName: 'Taply Wallet · Testnet' };
  };
  const adapter: WalletAdapter = {
    restore: session,
    async connect() {
      const value = await session();
      if (value === null) throw new WalletError('no_account');
      connected = true; for (const listener of listeners) listener(value); return value;
    },
    async disconnect() { vault.lock(); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async signAndSendTransaction(signerAccountId, call) {
      if (!TAPLY_WALLET_SIGNING_ENABLED || !FLAGS.instantPay.enabled || !input.confirmTransaction) throw new WalletError('unavailable');
      if (!connected || !vault.unlocked || vault.getIdentity()?.accountId !== signerAccountId) throw new WalletError('no_account');
      if (!['create_request', 'pay_instant_native', 'cancel_unfunded', 'retry_native_transfer'].includes(call.methodName)) throw new WalletError('failed');
      try {
        const review = await backend.prepareContractCall({ ...call, methodName: call.methodName as PreparedContractCall['methodName'] });
        const outcome = await backend.submit(review.id, input.confirmTransaction);
        return outcome.kind === 'unknown'
          ? { kind: 'unknown', ...(outcome.transactionHash ? { transactionHash: outcome.transactionHash } : {}) }
          : { kind: 'submitted', transactionHash: outcome.transactionHash };
      } catch (error) {
        if (error instanceof WalletEngineError && error.code === 'REVIEW_REJECTED') throw new WalletError('cancelled');
        throw new WalletError('failed');
      }
    },
  };
  return Object.freeze({
    adapter,
    get signingEnabled() { return TAPLY_WALLET_SIGNING_ENABLED; },
    get unlocked() { return vault.unlocked; },
    get connected() { return connected && vault.unlocked; },
    create: (password: string) => withVaultWriteLock(() => vault.create(password)),
    unlock: (password: string) => vault.unlock(password),
    lock: () => vault.lock(),
    exportEncryptedBackup: () => vault.exportEncryptedBackup(),
    restoreEncryptedBackup: (backup: string, password: string) => withVaultWriteLock(() => vault.restoreEncryptedBackup(backup, password)),
    read,
    prepareTransactionReview: backend.prepareTransfer,
    async confirmAndSend(reviewId: string) {
      if (!TAPLY_WALLET_SIGNING_ENABLED || !input.confirmTransaction) throw new WalletError('unavailable');
      return backend.submit(reviewId, input.confirmTransaction);
    },
    reconcileTransaction: backend.reconcile,
    receive() {
      const identity = vault.getIdentity();
      if (identity === null) throw new WalletEngineError('ACCOUNT_NOT_PROVISIONED');
      return { identity, qrPayload: identity.accountId, qr: encodeQr(identity.accountId) };
    },
    async prepareSend(receiverId: string, amountNear: string) {
      const value = await read();
      if (value.status !== 'PROVISIONED') throw new WalletEngineError('ACCOUNT_NOT_PROVISIONED');
      await chain.receiverExists(receiverId, value.balance.blockHash);
      return prepareNativeNearTransfer(value.balance, receiverId, amountNear);
    },
    dispose() {
      vault.lock(); unsubscribe(); listeners.clear();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('storage', storageChanged);
    },
  });
}
