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
  MainnetAuthorityCommand,
  MainnetGlobalAttemptStore,
  MainnetNearConnectWallet,
  MainnetOperation,
  MainnetSigningProfiles,
  MainnetWalletReview,
} from '@taply/near-client';
import { MAINNET_CONFIG } from './config';
import { deviceLedgerStore } from './device-ledger';
import { AuthorityError, createHttpMainnetAuthority, nearConnectAuthoritySigner, vaultAuthoritySigner } from './authority-client';
import type { AuthoritySigner } from './authority-client';
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
  | { readonly kind: 'simulated'; readonly store: MainnetGlobalAttemptStore }
  /** Release mode (NEXT_PUBLIC_TAPLY_MAINNET_LEDGER=device): Codex's coordinator on this browser's IndexedDB. */
  | { readonly kind: 'device'; readonly store: MainnetGlobalAttemptStore }
  /** Isolated test configurations only: Codex's authenticated authority over its unmounted HTTP adapter. */
  | { readonly kind: 'http' };

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

/**
 * Pure form of currentAuthority() for tests (the app calls currentAuthority()).
 * `sim` = NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION, `http` = NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY.
 * Both are test-configuration flags refused on Production. Setting both is ambiguous → unavailable.
 */
export function resolveAuthority(sim: string | undefined, fixtures: boolean, storage: Pick<Storage, 'getItem' | 'setItem'> | null, http?: string): AuthorityState {
  const wantsSim = sim === 'on', wantsHttp = http === 'isolated-http';
  if (wantsSim && wantsHttp) return { kind: 'unavailable' };
  if (wantsHttp) return { kind: 'http' };
  if (wantsSim && fixtures && storage !== null) return { kind: 'simulated', store: simulatedAuthorityStore(storage) };
  return { kind: 'unavailable' };
}
/**
 * Same decision as resolveAuthority, but every flag is compared as an inlined build-time constant
 * BEFORE the simulated store is referenced, so normal and authenticated-mode bundles do not contain
 * the test harness at all (CI greps every Mainnet bundle for it).
 */
export function currentAuthority(): AuthorityState {
  if (process.env.NEXT_PUBLIC_TAPLY_MAINNET_LEDGER === 'device') {
    // Exclusive with both test modes: a build with more than one ledger flag fails closed.
    if (process.env.NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY === 'isolated-http' || process.env.NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION === 'on') return { kind: 'unavailable' };
    if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') return { kind: 'unavailable' };
    return { kind: 'device', store: deviceLedgerStore(window.indexedDB) };
  }
  if (process.env.NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY === 'isolated-http') {
    return process.env.NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION === 'on' ? { kind: 'unavailable' } : { kind: 'http' };
  }
  if (process.env.NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION === 'on') {
    const storage = typeof window === 'undefined' ? null : window.localStorage;
    if (MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures && storage !== null) return { kind: 'simulated', store: simulatedAuthorityStore(storage) };
  }
  return { kind: 'unavailable' };
}

/** The authority signer for this wallet: Codex's fixed-purpose authorization only (gated). */
export function authoritySignerFor(signer: WalletSigner, confirm: (command: MainnetAuthorityCommand) => Promise<boolean>): AuthoritySigner {
  const id = signerIdentity(signer);
  if (signer.kind === 'internal') return vaultAuthoritySigner(signer.vault, id, confirm);
  const w = signer.wallet as MainnetNearConnectWallet & { signMessage?: (p: unknown) => Promise<{ accountId: string; publicKey: string; signature: string }> };
  if (typeof w.signMessage !== 'function') throw new Error('EXTERNAL_KEY_UNKNOWN');
  return nearConnectAuthoritySigner(w as never, id, confirm);
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

export type SubmitOutcome =
  | { readonly kind: 'FINAL_EXECUTION'; readonly transactionHash: string; readonly execution: 'SUCCESS' | 'FAILURE' }
  /** Never a failure: the ledger keeps blocking until the FINAL outcome is read (LedgerPanel). */
  | { readonly kind: 'OUTCOME_UNRESOLVED'; readonly transactionHash: string | null };

export interface PreparedOperation {
  readonly review: Readonly<MainnetWalletReview>;
  /**
   * Present only with a ledger (device / simulated): Codex's backend.submit on the SAME backend
   * instance that produced the review, then one FINAL read. Gated inside near-client
   * (MAINNET_PROTOCOL_SIGNING_RELEASED); the UI additionally requires MAINNET_CONFIG.signingEnabled.
   */
  readonly submit?: (confirm: (review: Readonly<MainnetWalletReview>) => Promise<boolean>) => Promise<SubmitOutcome>;
  /**
   * unavailable / http-gated / http-unavailable = exact review only, nothing can be reserved;
   * simulated = test harness; http = reviewed through the authenticated authority.
   */
  readonly authority: 'unavailable' | 'simulated' | 'device' | 'http' | 'http-gated' | 'http-unavailable';
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
  /** Shown before the wallet authorizes an authority command. */
  confirm?: (command: MainnetAuthorityCommand) => Promise<boolean>;
}): Promise<PreparedOperation> {
  const fetcher = input.fetcher ?? ((u, i) => globalThis.fetch(u, i));
  const id = signerIdentity(input.signer);
  const legacy = await legacyAttemptBlocks(id.accountId);
  if (legacy === 'unresolved') throw new Error('LEGACY_OUTCOME_UNRESOLVED');
  if (legacy === 'unavailable') throw new Error('JOURNAL_UNAVAILABLE');
  if (input.authority.kind === 'simulated' || input.authority.kind === 'device') {
    const backend = createMainnetWalletBackend({ profiles: input.profiles, deviceId: input.deviceId, signer: input.signer, store: input.authority.store }, fetcher);
    const review = await backend.prepare(input.operation);
    const signer = input.signer;
    // A locked Taply Wallet must be refused BEFORE the reservation: once reserved, a signing
    // failure is recorded as UNCERTAIN (correctly, by Codex's handoff) and blocks new payments.
    const assertUnlocked = () => { if (signer.kind === 'internal' && !signer.vault.unlocked) throw new Error('WALLET_LOCKED'); };
    return {
      review, authority: input.authority.kind,
      submit: (confirm) => {
        assertUnlocked();
        return submitReviewed(backend, review, async (r) => { assertUnlocked(); const ok = await confirm(r); assertUnlocked(); return ok; });
      },
    };
  }
  let fallback: PreparedOperation['authority'] = 'unavailable';
  if (input.authority.kind === 'http') {
    // Codex's backend with the authenticated authority: the ledger read (pending, owner device,
    // tombstones) needs a wallet authorization. Gate closed / endpoint absent → exact review only.
    try {
      const http = createHttpMainnetAuthority({ signer: authoritySignerFor(input.signer, input.confirm ?? (async () => false)), profiles: input.profiles, fetcher });
      await http.checkChallenge({ method: 'read' });
      const device = http.deviceId();
      if (device === null) throw new AuthorityError('AUTHORITY_UNAVAILABLE');
      const backend = createMainnetWalletBackend({ profiles: input.profiles, deviceId: device, signer: input.signer, authority: http }, fetcher);
      return { review: await backend.prepare(input.operation), authority: 'http' };
    } catch (e) {
      if (!(e instanceof AuthorityError)) throw e;
      if (e.code === 'INVALID_AUTHORITY_CHALLENGE' || e.code === 'IDENTITY_MISMATCH') throw new Error('AUTHORITY_POLICY_MISMATCH');
      fallback = e.code === 'SIGNING_DISABLED' ? 'http-gated' : 'http-unavailable';
    }
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
  return { review, authority: fallback };
}

/**
 * Codex's submit, then ONE FINAL read with the returned hash. Any error after the reservation is
 * already recorded as UNCERTAIN by Codex's handoff; it is reported as unresolved, never as failed,
 * and nothing is retried. Errors BEFORE the reservation (gate closed, review changed/expired,
 * user rejected) are thrown unchanged: nothing was reserved or signed.
 */
export async function submitReviewed(
  backend: Pick<ReturnType<typeof createMainnetWalletBackend>, 'submit' | 'reconcile'>,
  review: Readonly<MainnetWalletReview>,
  confirm: (review: Readonly<MainnetWalletReview>) => Promise<boolean>,
  reads = 4, delayMs = 1500,
): Promise<SubmitOutcome> {
  const sent = await backend.submit(review.id, confirm);
  if (sent.transactionHash === null) return { kind: 'OUTCOME_UNRESOLVED', transactionHash: null };
  // Read-only FINAL lookups (an external wallet may return before finality). Never a resend.
  for (let i = 0; i < reads; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const r = await backend.reconcile(sent.transactionHash);
      if (r.kind === 'FINAL_EXECUTION') return { kind: 'FINAL_EXECUTION', transactionHash: r.transactionHash, execution: r.execution };
    } catch { /* stays unresolved; LedgerPanel reads it again on request */ }
  }
  return { kind: 'OUTCOME_UNRESOLVED', transactionHash: sent.transactionHash };
}

/** Ledger read / FINAL reconciliation, only through Codex's backend and only with a ledger. */
export function walletBackend(input: { signer: WalletSigner; profiles: MainnetSigningProfiles; authority: AuthorityState; deviceId: string }) {
  if (input.authority.kind !== 'simulated' && input.authority.kind !== 'device') return null;
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
