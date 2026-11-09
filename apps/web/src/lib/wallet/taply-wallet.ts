import {
  EncryptedTestnetVault, VaultError, WalletEngineError, createWalletChain, ed25519PublicKeyFromHex,
  isNamedTestnetAccount, recoveryPhrasePublicKeyHex, prepareNativeNearTransfer, VAULT_STORAGE_KEY, createReviewedWalletBackend,
} from '@taply/near-client';
import type { LocalWalletIdentity, NearTestnetConfig, VaultStorage, WalletBalanceSnapshot, WalletChain, WalletTransactionReview, PreparedContractCall } from '@taply/near-client';
import { encodeQr } from '@/lib/qr/encode';
import { FLAGS } from '@/lib/flags/features';
import { WalletError } from './adapter';
import type { WalletAdapter, WalletSession } from './adapter';
import { requestTestnetAccount } from './testnet-account';
import type { FaucetFailure, FaucetResult } from './testnet-account';

/** Human security review + an independently tested SDK signer are prerequisites.
 * No env, query parameter, vault unlock or UI action can enable this constant.
 */
export const TAPLY_WALLET_SIGNING_ENABLED = false as const;

export type TaplyWalletRead =
  | { readonly status: 'NOT_CREATED' }
  /** `nameTaken`: the named account exists on chain but does NOT hold this vault's key. */
  | { readonly status: 'LOCAL_ONLY'; readonly identity: LocalWalletIdentity; readonly nameTaken?: true }
  | { readonly status: 'PROVISIONED'; readonly identity: LocalWalletIdentity; readonly balance: WalletBalanceSnapshot };

/** The requested `*.testnet` name already exists on NEAR Testnet. */
export class TaplyNameTakenError extends Error {
  constructor() { super('taply-wallet:NAME_TAKEN'); this.name = 'TaplyNameTakenError'; }
}

/** The recovery phrase does not control the account it was imported for. */
export class TaplyPhraseMismatchError extends Error {
  constructor(readonly reason: 'ACCOUNT_NOT_FOUND' | 'KEY_NOT_ON_ACCOUNT') { super(`taply-wallet:PHRASE_${reason}`); this.name = 'TaplyPhraseMismatchError'; }
}

/** Outcome of `activate()`. Only ON_CHAIN means the account exists with this key. */
export type TaplyActivation =
  | { readonly status: 'ON_CHAIN'; readonly identity: LocalWalletIdentity }
  | { readonly status: 'NAME_TAKEN' }
  | { readonly status: 'FAUCET_FAILED'; readonly reason: FaucetFailure }
  /** The faucet answered but FINAL reads do not show the account yet. Not a failure claim. */
  | { readonly status: 'PENDING' };

/** Library integration seam. Default WalletProvider remains external/Meteor.
 * Account creation is only the public Testnet faucet for a named `*.testnet`
 * vault identity, always confirmed by FINAL chain reads. No automatic migration
 * of an external wallet.
 */
export function createTaplyWalletController(input: {
  readonly config: NearTestnetConfig;
  readonly storage: VaultStorage;
  readonly crypto?: Crypto;
  /** Deterministic read-only test seam; production uses createWalletChain. */
  readonly chain?: WalletChain;
  readonly confirmTransaction?: (review: WalletTransactionReview) => Promise<boolean>;
  /** Test seam for the public Testnet faucet. */
  readonly requestAccount?: (accountId: string, publicKey: string) => Promise<FaucetResult>;
  /** Test seam for the provisioning poll interval. */
  readonly sleep?: (ms: number) => Promise<void>;
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

  const publicKeyOf = (identity: LocalWalletIdentity) => ed25519PublicKeyFromHex(identity.publicKeyHex);
  const onChain = (identity: LocalWalletIdentity): LocalWalletIdentity => Object.freeze({ ...identity, provisioning: 'ON_CHAIN' as const });
  const read = async (): Promise<TaplyWalletRead> => {
    const identity = vault.getIdentity();
    if (identity === null) return { status: 'NOT_CREATED' };
    let balance: WalletBalanceSnapshot | null;
    try {
      balance = await chain.snapshot(identity.accountId, publicKeyOf(identity));
    } catch (error) {
      // The account exists but the key read failed: tell "someone else owns this
      // name" apart from an RPC problem with a FINAL key-list read.
      if (await chain.provisioning(identity.accountId, publicKeyOf(identity)).catch(() => null) === 'KEY_NOT_ON_ACCOUNT')
        return { status: 'LOCAL_ONLY', identity, nameTaken: true };
      throw error;
    }
    return balance === null ? { status: 'LOCAL_ONLY', identity } : { status: 'PROVISIONED', identity: onChain(identity), balance };
  };
  const provisioning = async () => {
    const identity = vault.getIdentity();
    if (identity === null) throw new WalletEngineError('ACCOUNT_NOT_PROVISIONED');
    return { identity, status: await chain.provisioning(identity.accountId, publicKeyOf(identity)) };
  };
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const faucet = input.requestAccount ?? ((accountId: string, publicKey: string) => requestTestnetAccount(accountId, publicKey));
  /** Polls FINAL provisioning reads; never infers success from the faucet. */
  const confirm = async (attempts: number): Promise<TaplyActivation> => {
    for (let i = 0; i < attempts; i++) {
      const current = await provisioning().catch(() => null);
      if (current?.status === 'ON_CHAIN') return { status: 'ON_CHAIN', identity: onChain(current.identity) };
      if (current?.status === 'KEY_NOT_ON_ACCOUNT') return { status: 'NAME_TAKEN' };
      if (i + 1 < attempts) await sleep(1_500);
    }
    return { status: 'PENDING' };
  };
  let activating: Promise<TaplyActivation> | null = null;
  const activate = (): Promise<TaplyActivation> => {
    // One faucet request at a time per tab (double taps, re-renders).
    activating ??= (async () => {
      const first = await provisioning();
      if (!isNamedTestnetAccount(first.identity.accountId)) throw new WalletEngineError('INVALID_ADDRESS');
      if (first.status === 'ON_CHAIN') return { status: 'ON_CHAIN', identity: onChain(first.identity) } as const;
      if (first.status === 'KEY_NOT_ON_ACCOUNT') return { status: 'NAME_TAKEN' } as const;
      const result = await faucet(first.identity.accountId, publicKeyOf(first.identity));
      if (result.ok) return confirm(20);
      // A timeout may still have created it; a refusal may follow an earlier success.
      const after = await confirm(result.reason === 'unavailable' ? 4 : 1);
      return after.status === 'PENDING' ? { status: 'FAUCET_FAILED', reason: result.reason } as const : after;
    })().finally(() => { activating = null; });
    return activating;
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
      if (call.actions !== undefined) throw new WalletError('failed');
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
    /** Free at the current FINAL block? Throws when Testnet cannot be read. */
    isAccountAvailable: async (accountId: string) => !(await chain.accountExists(accountId)),
    /** Local vault bound to a named `*.testnet` account. Creates nothing on chain. */
    createNamed: (password: string, accountId: string) => withVaultWriteLock(() => vault.create(password, accountId)),
    /** The 12 words (password required). Never logged, stored or sent by Taply. */
    revealRecoveryPhrase: (password: string) => vault.revealRecoveryPhrase(password),
    /**
     * Imports a recovery phrase. For a named account, a FINAL read must first show
     * the account holds the phrase's key with full access; nothing is stored otherwise.
     */
    restoreFromRecoveryPhrase: (phrase: string, password: string, accountId?: string) => withVaultWriteLock(async () => {
      const cryptoImpl = input.crypto ?? globalThis.crypto;
      const publicKeyHex = await recoveryPhrasePublicKeyHex(cryptoImpl, phrase);
      if (publicKeyHex === null) throw new VaultError('INVALID_PHRASE');
      if (accountId !== undefined) {
        const status = await chain.provisioning(accountId, ed25519PublicKeyFromHex(publicKeyHex));
        if (status !== 'ON_CHAIN') throw new TaplyPhraseMismatchError(status);
      }
      return vault.restoreFromRecoveryPhrase(phrase, password, accountId);
    }),
    /** Faucet request + FINAL confirmation for the vault's named account. No passphrase needed. */
    activate,
    /** Binds the same key to another free name, only while the current one is not proven on chain. */
    rebindName: (password: string, accountId: string) => withVaultWriteLock(async () => {
      const current = await provisioning();
      if (current.status === 'ON_CHAIN') throw new VaultError('ALREADY_EXISTS');
      if (await chain.accountExists(accountId)) throw new TaplyNameTakenError();
      return vault.rebindAccount(password, accountId);
    }),
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
