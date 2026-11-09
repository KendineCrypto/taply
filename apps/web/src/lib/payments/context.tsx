'use client';

import '@/lib/security/zod-jitless';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { contractConfigProblems } from '@taply/near-client';
import type { ContractConfig, ContractConfigProblem, NearTestnetClient, RpcErrorCode } from '@taply/near-client';
import { FLAGS } from '@/lib/flags/features';
import { getNearClient } from '@/lib/near/client';
import { CHAIN_CONFIG, verifierProviders } from '@/lib/near/config';
import { createFetchLocatorRpc, createFetchVerifierRpc } from '@/lib/verify/rpc';
import { createRateLimitGate } from '@/lib/verify/rate-limit';
import type { LocatorRpc, VerifierRpc } from '@/lib/verify/rpc';
import { chainFreshness } from './freshness';
import type { ChainFreshness } from './freshness';
import { JOURNAL_STORAGE_KEY, SubmissionJournal } from './journal';
import type { JournalStorage } from './journal';
import { browserJournalLock } from './journal-lock';
import type { JournalLock } from './journal-lock';
import { WalletReturnInbox, captureWalletReturn, parseWalletReturn, processWalletReturns } from './wallet-return';

/**
 * Payments gate.
 *
 * Reads (status, receipts) need only a configured contract. SIGNING needs all of:
 *   1. a configured contract account + approved code hash (env),
 *   2. the `instantPay` flag turned on (env; a human decision after Testnet review),
 *   3. this session's `get_config` read, at a final block whose code hash matched,
 *      reporting no capability problems (no fault build, no Protected Pay, ...).
 * If any is missing the UI still renders every screen, but no wallet request is
 * ever made. Nothing here can be enabled from the browser.
 */

export type PaymentsReader = Pick<
  NearTestnetClient,
  'readContractConfig' | 'quoteCreateRequest' | 'readPaymentRequest' | 'readTerminalFacts' | 'readNativeBalance'
>;

export type PaymentsSetup =
  | { readonly status: 'chain_unavailable' }
  | { readonly status: 'not_configured' }
  | { readonly status: 'invalid_config' }
  | {
      readonly status: 'ready';
      readonly contractId: string;
      readonly expectedCodeHash: string;
      readonly reader: PaymentsReader;
      readonly signingFlag: boolean;
      readonly explorerBaseUrl: string;
      /** Read-only RPC for the independent receipt verifier; null disables Verified Paid. */
      readonly verifierRpc: VerifierRpc | null;
      /** Second archival provider, used only after a transient verifier failure. */
      readonly verifierFallbackRpc?: VerifierRpc | null;
      /**
       * Phase 7G: read-only `block`/`chunk` reads that locate a funding
       * transaction from chain data. Its result is only a candidate for the
       * verifier above, never proof. Absent/null: no automatic search.
       */
      readonly locatorRpc?: LocatorRpc | null;
      /** Second archival provider for the funding search, used only after a transient result. */
      readonly locatorFallbackRpc?: LocatorRpc | null;
    };

export type VerifiedCheck = {
  readonly status: 'verified';
  readonly config: ContractConfig;
  /** Chain time of the final block that verified the contract. */
  readonly observedAtNs: string;
  /** Device time (ms) when that read completed; used only to decide when to re-read. */
  readonly checkedAtMs: number;
};

export type ContractCheck =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | VerifiedCheck
  | { readonly status: 'rejected'; readonly problems: ReadonlyArray<ContractConfigProblem> }
  | { readonly status: 'unreachable'; readonly error: RpcErrorCode | null }
  /** The final block was too old or ahead of this device's clock. Signing pauses. */
  | { readonly status: 'stale_chain'; readonly freshness: Exclude<ChainFreshness, 'fresh'> };

/** A verified check is reused for at most this long before a financial action re-reads it. */
export const CHECK_REUSE_MS = 30_000;

/** Why signing is unavailable, in the order a person would need to fix it. */
export type SigningBlock =
  | 'chain_unavailable'
  | 'not_configured'
  | 'invalid_config'
  | 'contract_unverified'
  | 'contract_rejected'
  | 'signing_flag_off';

interface PaymentsValue {
  readonly setup: PaymentsSetup;
  readonly check: ContractCheck;
  readonly recheck: () => void;
  /**
   * Call right before building new terms or authorizing a payment. Returns a
   * verified check whose final block is fresh (re-reading get_config when the
   * current one is older than CHECK_REUSE_MS), or null (the check state then
   * explains why). Never signs anything.
   */
  readonly ensureFreshCheck: () => Promise<VerifiedCheck | null>;
  /** Device clock in ms; injectable so tests can pin chain time. */
  readonly now: () => number;
  /** null when signing is allowed; otherwise the first unmet condition. */
  readonly signingBlock: SigningBlock | null;
  readonly journal: SubmissionJournal | null;
  /** Increments whenever something outside a screen (wallet redirect recovery) changed the journal. */
  readonly journalVersion: number;
  /** Wallet-returned transaction hashes still waiting to be matched on chain (Phase 6A). */
  readonly walletReturnsPending: number;
}

const PaymentsContext = createContext<PaymentsValue | null>(null);

function defaultSetup(): PaymentsSetup {
  if (!CHAIN_CONFIG.ok) return { status: 'chain_unavailable' };
  const { contract } = CHAIN_CONFIG;
  if (contract.status === 'not_configured') return { status: 'not_configured' };
  if (contract.status === 'invalid') return { status: 'invalid_config' };
  const reader = getNearClient();
  if (reader === null) return { status: 'chain_unavailable' };
  const { primary, secondary } = verifierProviders(CHAIN_CONFIG);
  // One cool-down per provider, shared by the verifier and the locator that use it.
  const primaryGate = createRateLimitGate();
  return {
    status: 'ready',
    contractId: contract.accountId,
    expectedCodeHash: contract.expectedCodeHash,
    reader,
    signingFlag: FLAGS.instantPay.enabled,
    explorerBaseUrl: CHAIN_CONFIG.explorerBaseUrl,
    verifierRpc: createFetchVerifierRpc({ rpcUrl: primary.rpcUrl, providerId: primary.rpcProviderId, rateLimitGate: primaryGate }),
    verifierFallbackRpc:
      secondary === null
        ? null
        : createFetchVerifierRpc({ rpcUrl: secondary.rpcUrl, providerId: secondary.rpcProviderId, rateLimitGate: createRateLimitGate() }),
    // Funding search (no hash known) runs on the fast archival provider; a found hash is only a candidate.
    locatorRpc: createFetchLocatorRpc({ rpcUrl: primary.rpcUrl, providerId: primary.rpcProviderId, rateLimitGate: primaryGate }),
    locatorFallbackRpc:
      secondary === null
        ? null
        : createFetchLocatorRpc({ rpcUrl: secondary.rpcUrl, providerId: secondary.rpcProviderId, rateLimitGate: createRateLimitGate() }),
  };
}

function browserStorage(): JournalStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function signingBlockFor(setup: PaymentsSetup, check: ContractCheck): SigningBlock | null {
  if (setup.status !== 'ready') return setup.status;
  if (check.status === 'rejected') return 'contract_rejected';
  if (check.status !== 'verified') return 'contract_unverified';
  if (!setup.signingFlag) return 'signing_flag_off';
  return null;
}

export function PaymentsProvider({
  children,
  setup: injected,
  storage: injectedStorage,
  journalLock: injectedLock,
  now: injectedNow,
}: {
  readonly children: ReactNode;
  /** Tests inject a setup with a deterministic reader. */
  readonly setup?: PaymentsSetup;
  readonly storage?: JournalStorage | null;
  /** Default: browser Web Locks; null when unavailable (new attempts then refuse). */
  readonly journalLock?: JournalLock | null;
  readonly now?: () => number;
}) {
  const [setup] = useState<PaymentsSetup>(() => injected ?? defaultSetup());
  const [now] = useState<() => number>(() => injectedNow ?? (() => Date.now()));
  const [journal] = useState<SubmissionJournal | null>(() => {
    const storage = injectedStorage === undefined ? browserStorage() : injectedStorage;
    const lock = injectedLock === undefined ? browserJournalLock() : injectedLock;
    return storage === null ? null : new SubmissionJournal(storage, () => new Date(), lock);
  });
  const [check, setCheck] = useState<ContractCheck>(() =>
    setup.status === 'ready' ? { status: 'checking' } : { status: 'idle' },
  );
  const [generation, setGeneration] = useState(0);
  const [journalVersion, setJournalVersion] = useState(0);
  const [inbox] = useState<WalletReturnInbox | null>(() => {
    const storage = injectedStorage === undefined ? browserStorage() : injectedStorage;
    const lock = injectedLock === undefined ? browserJournalLock() : injectedLock;
    return storage === null ? null : new WalletReturnInbox(storage, undefined, lock);
  });
  // Known before the first pass finishes, so screens can wait for a returned hash.
  const [walletReturnsPending, setWalletReturnsPending] = useState<number>(() => {
    if (inbox === null || typeof window === 'undefined') return 0;
    const inUrl = parseWalletReturn(window.location.search)?.kind === 'hashes' ? 1 : 0;
    return inbox.items().filter((i) => i.kind === 'hashes').length + inUrl;
  });

  // Wallet redirect recovery: capture `?transactionHashes=` / `?errorCode=` once,
  // strip them from the address bar, then bind hashes to journal entries only
  // after the chain confirms them. Read-only; never signs or resubmits.
  useEffect(() => {
    if (inbox === null || journal === null || typeof window === 'undefined') return;
    const rpc = setup.status === 'ready' ? setup.verifierRpc : null;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let passes = 0;
    const pass = () => {
      void (async () => {
        // Capture before stripping, even if storage was temporarily full/unavailable.
        // A failed capture leaves the original URL available for the next pass.
        await captureWalletReturn(inbox, window.location, (url) => window.history.replaceState(window.history.state, '', url)).catch(() => undefined);
        return processWalletReturns({ inbox, journal, rpc });
      })().then(
        ({ journalChanged, pending }) => {
          if (!active) return;
          setWalletReturnsPending(pending);
          if (journalChanged) setJournalVersion((v) => v + 1);
          if (pending > 0 || parseWalletReturn(window.location.search) !== null) {
            timer = setTimeout(pass, Math.min(5_000 * 2 ** Math.min(passes++, 3), 30_000));
          }
        },
        () => {
          if (active) timer = setTimeout(pass, 30_000);
        },
      );
    };
    pass();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [inbox, journal, setup]);

  // Another tab changed the journal: let screens re-read it (and show its brakes).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === JOURNAL_STORAGE_KEY || event.key === null) setJournalVersion((v) => v + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** One get_config read at a final block, judged for approval and freshness. */
  const readCheck = useCallback(async (): Promise<ContractCheck> => {
    if (setup.status !== 'ready') return { status: 'idle' };
    try {
      const { observation, error } = await setup.reader.readContractConfig();
      const config = observation.data;
      const block = observation.observedBlock;
      if (error !== null || config === null || block === null) return { status: 'unreachable', error: error?.code ?? null };
      // Only a live, final RPC read can verify the contract for signing.
      if (observation.source !== 'rpc' || observation.assurance !== 'verified_final') return { status: 'unreachable', error: null };
      const problems = contractConfigProblems(config, setup.contractId);
      if (problems.length > 0) return { status: 'rejected', problems };
      const freshness = chainFreshness(block.timestampNs, now());
      if (freshness !== 'fresh') return { status: 'stale_chain', freshness };
      return { status: 'verified', config, observedAtNs: block.timestampNs, checkedAtMs: now() };
    } catch {
      return { status: 'unreachable', error: null };
    }
  }, [setup, now]);

  // Mount, and every explicit recheck.
  useEffect(() => {
    if (setup.status !== 'ready') return;
    let active = true;
    void readCheck().then((next) => {
      if (active) setCheck(next);
    });
    return () => {
      active = false;
    };
  }, [setup, readCheck, generation]);

  const recheck = useCallback(() => {
    setCheck({ status: 'checking' });
    setGeneration((g) => g + 1);
  }, []);

  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);

  // Back from the background: an aged capability check is refreshed, so the
  // screen does not keep offering signing on an old verification.
  useEffect(() => {
    if (setup.status !== 'ready' || typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const current = checkRef.current;
      if (current.status === 'verified' && now() - current.checkedAtMs <= CHECK_REUSE_MS) return;
      if (current.status === 'checking') return;
      recheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [setup, now, recheck]);

  const ensureFreshCheck = useCallback(async (): Promise<VerifiedCheck | null> => {
    const current = checkRef.current;
    if (
      current.status === 'verified' &&
      now() - current.checkedAtMs <= CHECK_REUSE_MS &&
      chainFreshness(current.observedAtNs, now()) === 'fresh'
    ) {
      return current;
    }
    const next = await readCheck();
    checkRef.current = next;
    setCheck(next);
    return next.status === 'verified' ? next : null;
  }, [now, readCheck]);

  const value = useMemo<PaymentsValue>(
    () => ({
      setup,
      check,
      recheck,
      ensureFreshCheck,
      now,
      signingBlock: signingBlockFor(setup, check),
      journal,
      journalVersion,
      walletReturnsPending,
    }),
    [setup, check, recheck, ensureFreshCheck, now, journal, journalVersion, walletReturnsPending],
  );

  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}

export function usePayments(): PaymentsValue {
  const value = useContext(PaymentsContext);
  if (value === null) throw new Error('usePayments must be used inside <PaymentsProvider>');
  return value;
}
