import {
  createMainnetAttemptJournal,
  createMainnetOperationPlanner,
  createMainnetWalletBackend,
  createMainnetWalletChain,
  ed25519PublicKeyFromHex,
  openMainnetAttemptStore,
} from '@taply/near-client';
import type {
  EncryptedMainnetVault,
  MainnetGlobalAttemptStore,
  MainnetNearConnectWallet,
  MainnetOperation,
  MainnetSigningProfiles,
  MainnetWalletReview,
} from '@taply/near-client';
import { MAINNET_CONFIG } from './config';
import { ESCROW_PROFILE } from './escrow-profile';
import { GIFT_PROFILE } from './gift-profile';

/**
 * The one place the Mainnet app reaches Codex's unified wallet protocol
 * (docs/MAINNET_PHASE4_PROTOCOL.md). Every financial action is
 * `createMainnetOperationPlanner` / `createMainnetWalletBackend`; this module
 * never builds an action, never keeps its own ledger and never signs.
 *
 * Authority: the coordinator needs ONE authenticated, account-global, durable
 * CAS authority. No reviewed browser adapter for `apps/api`'s
 * `createMainnetWalletAuthority` exists yet (API change request), so every real
 * build resolves the authority as UNAVAILABLE: reviews are shown, nothing can be
 * reserved, handed off or submitted, and the unknown-outcome panel says it cannot
 * see other devices. A SIMULATED single-browser store exists only for test builds
 * (`NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION=on` with fixtures; refused on
 * Production by scripts/check-mainnet-env.mjs). It is passed to Codex's own
 * coordinator via `createMainnetWalletBackend({ store })` and is labelled on screen.
 */

const HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** USDC token code pin. Mandatory for USDC operations; never guessed. Observation ≠ approval. */
export function resolveUsdcCodeHash(value: string | undefined): string | undefined {
  return value !== undefined && HASH.test(value) ? value : undefined;
}
export const USDC_CODE_HASH = resolveUsdcCodeHash(process.env.NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH);

export function signingProfiles(): MainnetSigningProfiles | null {
  if (!MAINNET_CONFIG.ok) return null;
  return {
    network: { network: 'near-mainnet', rpcUrl: MAINNET_CONFIG.rpcUrl, rpcProviderId: MAINNET_CONFIG.rpcProviderId },
    ...(MAINNET_CONFIG.profile ? { instant: MAINNET_CONFIG.profile } : {}),
    ...(ESCROW_PROFILE ? { escrow: ESCROW_PROFILE } : {}),
    ...(GIFT_PROFILE ? { gift: GIFT_PROFILE } : {}),
    ...(USDC_CODE_HASH ? { usdcCodeHash: USDC_CODE_HASH } : {}),
  };
}

const DEVICE_KEY = 'taply.mainnet.device.v1';
/** Stable per-browser device id (UUID v4). Created once; a corrupt record fails closed, never silently replaced. */
export function deviceId(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  const v = storage.getItem(DEVICE_KEY);
  if (v === null) {
    const id = globalThis.crypto.randomUUID();
    storage.setItem(DEVICE_KEY, id);
    return id;
  }
  if (!UUID.test(v)) throw new Error('DEVICE_ID_INVALID');
  return v;
}

export type AuthorityState =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'simulated'; readonly store: MainnetGlobalAttemptStore };

export const SIM_AUTHORITY_PREFIX = 'taply.mainnet.sim-authority.v2:';
/** TEST ONLY. Single-browser localStorage CAS. Declared account-global for Codex's coordinator; it is not. */
export function simulatedAuthorityStore(storage: Pick<Storage, 'getItem' | 'setItem'>): MainnetGlobalAttemptStore {
  return {
    scope: 'account-global',
    read: async (accountId) => storage.getItem(SIM_AUTHORITY_PREFIX + accountId),
    compareAndSwap: async (accountId, expected, next) => {
      if (storage.getItem(SIM_AUTHORITY_PREFIX + accountId) !== expected) return false;
      storage.setItem(SIM_AUTHORITY_PREFIX + accountId, next);
      return true;
    },
  };
}

export function resolveAuthority(flag: string | undefined, fixtures: boolean, storage: Pick<Storage, 'getItem' | 'setItem'> | null): AuthorityState {
  if (flag === 'on' && fixtures && storage !== null) return { kind: 'simulated', store: simulatedAuthorityStore(storage) };
  return { kind: 'unavailable' };
}
export function currentAuthority(): AuthorityState {
  return resolveAuthority(
    process.env.NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION,
    MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures,
    typeof window === 'undefined' ? null : window.localStorage,
  );
}

export type WalletSigner =
  | { readonly kind: 'internal'; readonly vault: EncryptedMainnetVault }
  | { readonly kind: 'near-connect'; readonly wallet: MainnetNearConnectWallet; readonly accountId: string; readonly publicKey: string };

export function signerIdentity(signer: WalletSigner): { accountId: string; publicKey: string } {
  if (signer.kind === 'near-connect') return { accountId: signer.accountId, publicKey: signer.publicKey };
  const id = signer.vault.getIdentity();
  if (!id || id.network !== 'near-mainnet') throw new Error('WALLET_NOT_CREATED');
  return { accountId: id.accountId, publicKey: ed25519PublicKeyFromHex(id.publicKeyHex) };
}

export interface PreparedOperation {
  readonly review: Readonly<MainnetWalletReview>;
  /** 'reviewable' = exact review only, nothing can be reserved (no authority). */
  readonly authority: 'unavailable' | 'simulated';
}

/** Legacy v1 IndexedDB journal: never migrated. Any entry (or an unreadable journal) blocks new payments. */
export async function legacyAttemptBlocks(accountId: string): Promise<'none' | 'unresolved' | 'unavailable'> {
  try {
    const store = await openMainnetAttemptStore();
    try { return (await createMainnetAttemptJournal(store).read(accountId)) === null ? 'none' : 'unresolved'; }
    finally { store.close(); }
  } catch { return 'unavailable'; }
}

/**
 * Exact review for one operation. With an authority: Codex's backend.prepare
 * (pending/ownership/tombstone checks included). Without: Codex's planner on a
 * fresh anchored snapshot, returned as a review that cannot be reserved.
 */
export async function prepareOperation(input: {
  operation: MainnetOperation; signer: WalletSigner; profiles: MainnetSigningProfiles; authority: AuthorityState; deviceId: string;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<PreparedOperation> {
  const fetcher = input.fetcher ?? ((u, i) => globalThis.fetch(u, i));
  const id = signerIdentity(input.signer);
  const legacy = await legacyAttemptBlocks(id.accountId);
  if (legacy === 'unresolved') throw new Error('LEGACY_OUTCOME_UNRESOLVED');
  if (legacy === 'unavailable') throw new Error('JOURNAL_UNAVAILABLE');
  if (input.authority.kind === 'simulated') {
    const backend = createMainnetWalletBackend({ profiles: input.profiles, deviceId: input.deviceId, signer: input.signer, store: input.authority.store }, fetcher);
    return { review: await backend.prepare(input.operation), authority: 'simulated' };
  }
  const snapshot = await createMainnetWalletChain(input.profiles.network, fetcher).snapshot(id.accountId, id.publicKey);
  if (snapshot === null) throw new Error('ACCOUNT_NOT_ACTIVATED');
  const plan = await createMainnetOperationPlanner(input.profiles, fetcher).prepare(input.operation, snapshot);
  const review: MainnetWalletReview = Object.freeze({
    id: globalThis.crypto.randomUUID(), network: 'near-mainnet', accountId: snapshot.accountId, publicKey: snapshot.publicKey,
    receiverId: plan.receiverId, action: plan.action, operationHash: plan.operationHash,
    nonce: input.signer.kind === 'internal' ? (BigInt(snapshot.nonce) + 1n).toString() : null, minimumNonce: snapshot.nonce,
    blockHash: snapshot.blockHash, blockHeight: snapshot.blockHeight,
    gasReserveYocto: plan.gasReserveYocto, storageReserveYocto: plan.storageReserveYocto, expiresAtMs: Date.now() + 60_000,
  });
  return { review, authority: 'unavailable' };
}

/** Ledger read / FINAL reconciliation, only through Codex's backend and only with an authority. */
export function walletBackend(input: { signer: WalletSigner; profiles: MainnetSigningProfiles; authority: AuthorityState; deviceId: string }) {
  if (input.authority.kind !== 'simulated') return null;
  return createMainnetWalletBackend({ profiles: input.profiles, deviceId: input.deviceId, signer: input.signer, store: input.authority.store });
}

/**
 * Business id for a direct Send: 64 hex, stable for the same user operation
 * across crash/reload/review. Replaced ONLY by an explicit user action
 * ("Start a new payment"), never automatically to get around an outcome.
 */
export function businessIdKey(accountId: string, scope: string): string {
  return `taply.mainnet.business.v1:${accountId}:${scope}`;
}
export function stableBusinessId(storage: Pick<Storage, 'getItem' | 'setItem'>, accountId: string, scope: string): string {
  const key = businessIdKey(accountId, scope);
  const v = storage.getItem(key);
  if (v !== null) {
    if (!HEX64.test(v)) throw new Error('BUSINESS_ID_INVALID');
    return v;
  }
  return newBusinessId(storage, accountId, scope);
}
export function newBusinessId(storage: Pick<Storage, 'setItem'>, accountId: string, scope: string): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  const id = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  storage.setItem(businessIdKey(accountId, scope), id);
  return id;
}
