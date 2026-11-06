import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { TESTNET_GENESIS_HASH, createNearTestnetClient } from '@taply/near-client';
import type { ContractConfig } from '@taply/near-client';
import { calculateTermsHash } from '@/lib/protocol';
import type { ContractRequest, IntentTerms } from '@/lib/protocol';
import { I18nProvider } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import { PaymentsProvider } from '@/lib/payments/context';
import type { PaymentsSetup } from '@/lib/payments/context';
import type { JournalStorage } from '@/lib/payments/journal';
import { inProcessJournalLock } from '@/lib/payments/journal-lock';
import type { JournalLock } from '@/lib/payments/journal-lock';
import type { VerifierRpc } from '@/lib/verify/rpc';
import type { SignOutcome, WalletAdapter, WalletCall, WalletSession } from '@/lib/wallet/adapter';
import { WalletProvider } from '@/lib/wallet/provider';
import { TaplyWalletProvider } from '@/components/wallet/taply/TaplyWalletProvider';
import type { TaplyWalletController } from '@/components/wallet/taply/TaplyWalletProvider';

const noTaplyWallet = (): TaplyWalletController | null => null;
import openRestricted from './fixtures/sandbox/open-restricted.json';
import paidRestricted from './fixtures/sandbox/paid-restricted.json';
import open from './fixtures/sandbox/open.json';
import cancelled from './fixtures/sandbox/cancelled.json';
import failed from './fixtures/sandbox/failed.json';
import paidAfterRetry from './fixtures/sandbox/paid-after-retry.json';
import inFlight from './fixtures/sandbox/in-flight.json';

/**
 * Deterministic chain harness for integration tests.
 *
 * The fixtures are REAL `get_request` outputs captured from the 9/9 near-workspaces
 * sandbox run (GitHub Actions run 41236806667). They are served through a fake
 * JSON-RPC endpoint to the REAL `@taply/near-client` (genesis check, final block,
 * code-hash check, call_function decoding, strict JSON, shared schemas), so these
 * tests exercise the same read path the app uses against Testnet. Nothing here is
 * Testnet evidence.
 */

export const FIXTURES = {
  openRestricted: openRestricted as ContractRequest,
  paidRestricted: paidRestricted as ContractRequest,
  open: open as ContractRequest,
  cancelled: cancelled as ContractRequest,
  failed: failed as ContractRequest,
  paidAfterRetry: paidAfterRetry as ContractRequest,
  inFlight: inFlight as ContractRequest,
};

/** Test-only presence check: fails the test with a message instead of asserting with `!`. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** 32 zero bytes in base58: a syntactically valid code hash for the pin. */
export const CODE_HASH = '11111111111111111111111111111111';
export const OTHER_CODE_HASH = '11111111111111111111111111111112';
export const BLOCK_HASH = '11111111111111111111111111111113';

export function configFor(contractId: string, overrides: Partial<ContractConfig> = {}): ContractConfig {
  return {
    schemaVersion: 'taply.contract-config.v1',
    contractVersion: '0.4.0',
    network: 'near-testnet',
    contractId,
    intentVersion: 'taply.intent.v1',
    eventVersion: '0.4.0',
    capabilities: { instantNative: true, protectedPay: false, handshake: false, merchantProfiles: false, nep141: false, sponsoredGas: false },
    quoteVersion: '1',
    storageByteCostYocto: '10000000000000000000',
    gas: {
      createRequest: '30000000000000',
      payInstantNative: '50000000000000',
      retryNativeTransfer: '50000000000000',
      cancelUnfunded: '15000000000000',
      callback: '15000000000000',
    },
    storageRefundPolicy: 'PERMANENT_RECORD_NO_WITHDRAWAL',
    unknownCallbackPolicy: 'IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE',
    testFaultBuild: false,
    ...overrides,
  };
}

/** Real storage-bond quote format (586 bytes at the sandbox byte cost), bound to the given terms. */
export function quoteFor(terms: IntentTerms) {
  return {
    quoteVersion: '1',
    requestId: terms.id,
    termsHash: calculateTermsHash(terms),
    storageBytes: '586',
    depositYocto: '5860000000000000000000',
    gas: '30000000000000',
  };
}

export interface ChainState {
  contractId: string;
  /** Code hash the RPC reports for the contract account. */
  codeHash: string;
  blockTimestampNs: string;
  blockHeight: number;
  /** Mutable: tests change what the contract returns between reads. */
  requests: Map<string, ContractRequest>;
  config: ContractConfig;
  balanceYocto: string;
  calls: Array<{ method: string; requestType?: string; methodName?: string; args?: unknown }>;
}

export function installChain(init: Partial<ChainState> & { contractId: string }): ChainState {
  const chain: ChainState = {
    codeHash: CODE_HASH,
    blockTimestampNs: '1793476890000000000',
    blockHeight: 1000,
    requests: new Map(),
    config: configFor(init.contractId),
    balanceYocto: '10000000000000000000000000',
    calls: [],
    ...init,
  };
  const bytes = (value: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(value)));
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { id: string; method: string; params: Record<string, unknown> };
    const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: request.id, result });
    if (request.method === 'status') {
      chain.calls.push({ method: 'status' });
      return reply({ chain_id: 'testnet', genesis_hash: TESTNET_GENESIS_HASH, version: { version: '2.14.0' }, sync_info: { syncing: false } });
    }
    if (request.method === 'block') {
      chain.calls.push({ method: 'block' });
      return reply({ header: { hash: BLOCK_HASH, height: chain.blockHeight, timestamp_nanosec: chain.blockTimestampNs } });
    }
    const params = request.params;
    const anchored = { block_hash: BLOCK_HASH, block_height: chain.blockHeight };
    if (params['request_type'] === 'view_account') {
      chain.calls.push({ method: 'query', requestType: 'view_account' });
      const isContract = params['account_id'] === chain.contractId;
      return reply({
        amount: isContract ? '5000000000000000000000000' : chain.balanceYocto,
        locked: '0',
        storage_usage: 500,
        code_hash: isContract ? chain.codeHash : CODE_HASH,
        ...anchored,
      });
    }
    const methodName = String(params['method_name']);
    const argsBytes = Uint8Array.from(atob(String(params['args_base64'])), (c) => c.charCodeAt(0));
    const args = JSON.parse(new TextDecoder().decode(argsBytes)) as Record<string, unknown>;
    chain.calls.push({ method: 'query', requestType: 'call_function', methodName, args });
    let answer: unknown;
    if (methodName === 'get_config') answer = chain.config;
    else if (methodName === 'get_request') answer = chain.requests.get(String(args['id'])) ?? null;
    else if (methodName === 'quote_create_request') answer = quoteFor(args['terms'] as IntentTerms);
    else if (methodName === 'get_receipt') {
      const found = chain.requests.get(String(args['id']));
      answer =
        found !== undefined && (found.status === 'FINAL_PAID' || found.status === 'CANCELLED_UNFUNDED')
          ? {
              schemaVersion: 'taply.terminal-facts.v1',
              request: found,
              terminalBlockHeight: String(chain.blockHeight - 1),
              terminalAtNs: found.latestOperation?.resolvedAtNs ?? found.createdAtNs,
              payoutConfirmed: found.status === 'FINAL_PAID',
              evidenceKind: 'CONTRACT_FACTS_NOT_FINALITY_PROOF',
            }
          : null;
    } else throw new Error(`unexpected view ${methodName}`);
    return reply({ result: bytes(answer), logs: [], ...anchored });
  });
  return chain;
}

export function readySetup(
  chain: ChainState,
  signingFlag: boolean,
  expectedCodeHash = CODE_HASH,
  verifierRpc: VerifierRpc | null = null,
): PaymentsSetup {
  const setup: PaymentsSetup = {
    verifierRpc,
    status: 'ready',
    contractId: chain.contractId,
    expectedCodeHash,
    signingFlag,
    explorerBaseUrl: 'https://testnet.nearblocks.io',
    reader: createNearTestnetClient({
      network: 'near-testnet',
      rpcUrl: 'https://rpc.testnet.near.org',
      rpcProviderId: 'test-rpc',
      contract: { accountId: chain.contractId, expectedCodeHash },
    }),
  };
  CHAIN_OF.set(setup, chain);
  return setup;
}

/** Which fake chain a setup reads, so the device clock can follow its block time. */
const CHAIN_OF = new WeakMap<PaymentsSetup, ChainState>();

/** Device time pinned to the fake chain's latest final block (so its blocks are "fresh"). */
export function chainClock(chain: ChainState): () => number {
  // Whole milliseconds (a clock, not an amount): well inside the safe integer range.
  return () => Number.parseInt((BigInt(chain.blockTimestampNs) / 1_000_000n).toString(), 10);
}

export function memoryStorage(): JournalStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

/** A wallet that records every signing request and answers as scripted. Never signs anything real. */
export function recordingWallet(
  accountId: string | null,
  answer: (call: WalletCall) => Promise<SignOutcome> = async () => ({ kind: 'submitted', transactionHash: BLOCK_HASH }),
) {
  const signed: Array<{ signer: string; call: WalletCall }> = [];
  const session: WalletSession | null = accountId === null ? null : { accountId, walletId: 'fake', walletName: 'Fake Wallet' };
  const adapter: WalletAdapter = {
    restore: async () => session,
    connect: async () => {
      if (session === null) throw new Error('no wallet');
      return session;
    },
    disconnect: async () => undefined,
    subscribe: () => () => undefined,
    signAndSendTransaction: async (signer, call) => {
      signed.push({ signer, call });
      return answer(call);
    },
  };
  return { adapter, signed };
}

export function renderWithChain(
  ui: ReactNode,
  options: {
    setup: PaymentsSetup;
    adapter: WalletAdapter;
    storage?: JournalStorage;
    locale?: Locale;
    /** Taply Wallet controller factory. Default: none (the provider reports "unavailable"). */
    taply?: () => TaplyWalletController | null;
    /** Default: an in-process mutex (jsdom has no Web Locks). Pass null to test the fail-closed path. */
    journalLock?: JournalLock | null;
    /** Device clock. Default: the fake chain's block time, so reads are fresh. */
    now?: () => number;
  },
) {
  const chain = CHAIN_OF.get(options.setup);
  const now = options.now ?? (chain === undefined ? () => Date.now() : chainClock(chain));
  const journalLock = options.journalLock === undefined ? inProcessJournalLock() : options.journalLock;
  return render(
    <I18nProvider locale={options.locale ?? 'en'}>
      <WalletProvider adapter={options.adapter}>
        <PaymentsProvider setup={options.setup} storage={options.storage ?? memoryStorage()} journalLock={journalLock} now={now}>
          <TaplyWalletProvider factory={options.taply ?? noTaplyWallet}>{ui}</TaplyWalletProvider>
        </PaymentsProvider>
      </WalletProvider>
    </I18nProvider>,
  );
}
