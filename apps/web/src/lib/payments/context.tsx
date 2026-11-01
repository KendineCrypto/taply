'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { contractConfigProblems } from '@taply/near-client';
import type { ContractConfig, ContractConfigProblem, NearTestnetClient, RpcErrorCode } from '@taply/near-client';
import { FLAGS } from '@/lib/flags/features';
import { getNearClient } from '@/lib/near/client';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { createFetchVerifierRpc } from '@/lib/verify/rpc';
import type { VerifierRpc } from '@/lib/verify/rpc';
import { SubmissionJournal } from './journal';
import type { JournalStorage } from './journal';

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
    };

export type ContractCheck =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | { readonly status: 'verified'; readonly config: ContractConfig; readonly observedAtNs: string }
  | { readonly status: 'rejected'; readonly problems: ReadonlyArray<ContractConfigProblem> }
  | { readonly status: 'unreachable'; readonly error: RpcErrorCode | null };

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
  /** null when signing is allowed; otherwise the first unmet condition. */
  readonly signingBlock: SigningBlock | null;
  readonly journal: SubmissionJournal | null;
}

const PaymentsContext = createContext<PaymentsValue | null>(null);

function defaultSetup(): PaymentsSetup {
  if (!CHAIN_CONFIG.ok) return { status: 'chain_unavailable' };
  const { contract } = CHAIN_CONFIG;
  if (contract.status === 'not_configured') return { status: 'not_configured' };
  if (contract.status === 'invalid') return { status: 'invalid_config' };
  const reader = getNearClient();
  if (reader === null) return { status: 'chain_unavailable' };
  return {
    status: 'ready',
    contractId: contract.accountId,
    expectedCodeHash: contract.expectedCodeHash,
    reader,
    signingFlag: FLAGS.instantPay.enabled,
    explorerBaseUrl: CHAIN_CONFIG.explorerBaseUrl,
    verifierRpc: createFetchVerifierRpc({
      rpcUrl: CHAIN_CONFIG.client.rpcUrl,
      providerId: CHAIN_CONFIG.client.rpcProviderId,
    }),
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
}: {
  readonly children: ReactNode;
  /** Tests inject a setup with a deterministic reader. */
  readonly setup?: PaymentsSetup;
  readonly storage?: JournalStorage | null;
}) {
  const [setup] = useState<PaymentsSetup>(() => injected ?? defaultSetup());
  const [journal] = useState<SubmissionJournal | null>(() => {
    const storage = injectedStorage === undefined ? browserStorage() : injectedStorage;
    return storage === null ? null : new SubmissionJournal(storage);
  });
  const [check, setCheck] = useState<ContractCheck>(() =>
    setup.status === 'ready' ? { status: 'checking' } : { status: 'idle' },
  );
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (setup.status !== 'ready') return;
    let active = true;
    setup.reader.readContractConfig().then(
      ({ observation, error }) => {
        if (!active) return;
        const config = observation.data;
        const block = observation.observedBlock;
        if (error !== null || config === null || block === null) {
          setCheck({ status: 'unreachable', error: error?.code ?? null });
          return;
        }
        // Only a live, final RPC read can verify the contract for signing.
        if (observation.source !== 'rpc' || observation.assurance !== 'verified_final') {
          setCheck({ status: 'unreachable', error: null });
          return;
        }
        const problems = contractConfigProblems(config, setup.contractId);
        setCheck(
          problems.length > 0
            ? { status: 'rejected', problems }
            : { status: 'verified', config, observedAtNs: block.timestampNs },
        );
      },
      () => {
        if (active) setCheck({ status: 'unreachable', error: null });
      },
    );
    return () => {
      active = false;
    };
  }, [setup, generation]);

  const recheck = useCallback(() => {
    setCheck({ status: 'checking' });
    setGeneration((g) => g + 1);
  }, []);

  const value = useMemo<PaymentsValue>(
    () => ({ setup, check, recheck, signingBlock: signingBlockFor(setup, check), journal }),
    [setup, check, recheck, journal],
  );

  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}

export function usePayments(): PaymentsValue {
  const value = useContext(PaymentsContext);
  if (value === null) throw new Error('usePayments must be used inside <PaymentsProvider>');
  return value;
}
