import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentScreen } from '../PaymentScreen';
import { ReceiptScreen } from '../ReceiptScreen';
import { CODE_HASH, FIXTURES, installChain, memoryStorage, must, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { JOURNAL_STORAGE_KEY, SubmissionJournal } from '@/lib/payments/journal';
import { inProcessJournalLock } from '@/lib/payments/journal-lock';
import { WalletReturnInbox } from '@/lib/payments/wallet-return';
import { VerifierRpcError } from '@/lib/verify/rpc';
import { buildPaidChain, hashOf } from '@/lib/verify/__tests__/fake-chain';

/**
 * Phase 6A, task 4: the pilot's mobile payment showed "Paid per contract" and
 * "Settlement proof not available on this device". On a wallet redirect the pay
 * screen can see FINAL_PAID and resolve the attempt before the returned hash is
 * matched on chain; the hash was then dropped. Now it is attached, the receipt
 * opens with it, and the verifier runs by itself. Missing evidence stays honest.
 *
 * Contract reads: real near-client against the fake JSON-RPC. Verifier: the
 * synthetic receipt graph. Not Testnet evidence.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { paidRestricted } = FIXTURES;
const ID = paidRestricted.terms.id;
const PAYER = must(paidRestricted.payerAccountId, 'a payer');

beforeEach(() => {
  push.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

/**
 * `notIndexedYet`: the first lookup of a transaction finds nothing (the RPC node
 * has not seen it yet), so the wallet return is kept for the next pass, 5 s
 * later. Meanwhile the finalized read shows FINAL_PAID and the screen resolves
 * the hash-less attempt. This is the order of events that lost the hash.
 */
function paidWorld(notIndexedYet = false) {
  const chain = installChain({ contractId: paidRestricted.terms.contractId });
  chain.requests.set(ID, paidRestricted);
  const verifierChain = buildPaidChain(paidRestricted);
  verifierChain.chain.defaultCodeHash = CODE_HASH;
  const rpc = verifierChain.input.rpc;
  let firstLookup = notIndexedYet;
  const lagging: typeof rpc = {
    providerId: rpc.providerId,
    async call(method, params) {
      if (method === 'EXPERIMENTAL_tx_status' && firstLookup) {
        firstLookup = false;
        throw new VerifierRpcError('UNKNOWN_TRANSACTION');
      }
      return rpc.call(method, params);
    },
  };
  const setup = readySetup(chain, true, CODE_HASH, lagging);
  return { setup, fundingHash: verifierChain.input.fundingTransaction.hash };
}

/** The journal entry this device wrote before its wallet opened. */
async function ownAttempt() {
  const storage = memoryStorage();
  await new SubmissionJournal(storage, undefined, inProcessJournalLock()).begin({
    method: 'pay_instant_native',
    network: 'near-testnet',
    contractId: paidRestricted.terms.contractId,
    requestId: ID,
    termsHash: paidRestricted.termsHash,
    signerAccountId: PAYER,
    terms: null,
    operationNonce: null,
  });
  return storage;
}

function journalEntry(storage: ReturnType<typeof memoryStorage>) {
  const journal = JSON.parse(storage.data.get(JOURNAL_STORAGE_KEY) ?? '{}') as {
    entries: Array<{ phase: string; transactionHash: string | null }>;
  };
  return journal.entries[0];
}

describe('same-device mobile redirect → receipt → Verified Paid', () => {
  it('automatically retries delayed FINAL transaction availability without claiming verification early', async () => {
    const { setup, fundingHash } = paidWorld();
    const ready = setup as Extract<typeof setup, { status: 'ready' }>;
    const original = must(ready.verifierRpc, 'verifier RPC');
    let failOnce = true;
    let release!: () => void;
    const available = new Promise<void>((resolve) => { release = resolve; });
    const lagging = { ...original, async call(...args: Parameters<typeof original.call>) {
      if (args[0] === 'EXPERIMENTAL_tx_status' && failOnce) {
        failOnce = false;
        throw new VerifierRpcError('UNKNOWN_TRANSACTION');
      }
      if (args[0] === 'EXPERIMENTAL_tx_status') await available;
      return original.call(...args);
    } };
    window.history.replaceState(null, '', `/receipt/${ID}?ftx=${fundingHash}`);
    renderWithChain(<ReceiptScreen id={ID} />, {
      setup: { ...ready, verifierRpc: lagging }, adapter: recordingWallet(PAYER).adapter, storage: memoryStorage(),
    });
    expect(await screen.findByTestId('verification-failed', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
    await act(async () => release());
    expect(await screen.findByTestId('verified-evidence', {}, { timeout: 4000 })).toBeTruthy();
  });

  it('an unrelated pending wallet hash cannot block a follow-up with known funding evidence', async () => {
    const { setup, fundingHash } = paidWorld();
    const storage = await ownAttempt();
    const journal = new SubmissionJournal(storage);
    const entry = must(journal.find(ID, 'pay_instant_native', PAYER), 'own attempt');
    await journal.update(entry, { phase: 'SUBMITTED', transactionHash: fundingHash });
    await new WalletReturnInbox(storage).add({ kind: 'hashes', hashes: [hashOf('unrelated-hint')] });
    renderWithChain(<PaymentScreen id={ID} />, { setup, adapter: recordingWallet(PAYER).adapter, storage });
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/receipt/${ID}?ftx=${fundingHash}`));
  });
  it('attaches the returned hash, opens the receipt with it once, and the verifier confirms it', async () => {
    const { setup, fundingHash } = paidWorld(true);
    const storage = await ownAttempt();
    window.history.replaceState(null, '', `/pay/${ID}?transactionHashes=${fundingHash}`);
    const { adapter, signed } = recordingWallet(PAYER);

    renderWithChain(<PaymentScreen id={ID} />, { setup, adapter, storage });

    // The screen explains the attempt from the chain first...
    await waitFor(() => expect(journalEntry(storage)?.phase).toBe('RESOLVED'));
    expect(journalEntry(storage)?.transactionHash).toBeNull();
    expect(push).not.toHaveBeenCalled();
    // ...then the returned hash is matched and attached, and the receipt opens with it.
    const receipt = `/receipt/${ID}?ftx=${fundingHash}`;
    // The next wallet-return pass runs 5 s later.
    await waitFor(() => expect(push).toHaveBeenCalledWith(receipt), { timeout: 9000 });
    expect(push).toHaveBeenCalledTimes(1);
    expect(journalEntry(storage)).toMatchObject({ phase: 'RESOLVED', transactionHash: fundingHash });
    expect(signed).toEqual([]);
    cleanup();

    // The receipt the follow-up opened: verification starts by itself.
    window.history.replaceState(null, '', receipt);
    renderWithChain(<ReceiptScreen id={ID} />, { setup, adapter: recordingWallet(PAYER).adapter, storage });
    expect(await screen.findByTestId('verified-evidence')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Verified Paid' })).toBeTruthy();
  }, 15_000);

  it('opening the pay screen again later does not navigate a second time', async () => {
    const { setup, fundingHash } = paidWorld();
    const storage = await ownAttempt();
    window.history.replaceState(null, '', `/pay/${ID}?transactionHashes=${fundingHash}`);
    renderWithChain(<PaymentScreen id={ID} />, { setup, adapter: recordingWallet(PAYER).adapter, storage });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    cleanup();
    renderWithChain(<PaymentScreen id={ID} />, { setup, adapter: recordingWallet(PAYER).adapter, storage });
    expect(await screen.findByRole('link', { name: 'View receipt' })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('missing transaction evidence stays honest', () => {
  it('the wallet returned nothing: receipt opens without a hint and says the wallet kept the reference', async () => {
    const { setup } = paidWorld();
    const storage = await ownAttempt();
    renderWithChain(<PaymentScreen id={ID} />, { setup, adapter: recordingWallet(PAYER).adapter, storage });
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/receipt/${ID}`));
    expect(journalEntry(storage)).toMatchObject({ phase: 'RESOLVED', transactionHash: null });
    cleanup();

    window.history.replaceState(null, '', `/receipt/${ID}`);
    renderWithChain(<ReceiptScreen id={ID} />, { setup, adapter: recordingWallet(PAYER).adapter, storage });
    expect(await screen.findByText('Your wallet did not return the transaction reference')).toBeTruthy();
    expect(screen.getByText('Paid per contract')).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Verified Paid' })).toBeNull();
  });

  it('a returned hash still being matched shows "matching", never Verified Paid', async () => {
    const { setup } = paidWorld();
    const storage = await ownAttempt();
    // A hash the chain cannot place yet: kept in the inbox for a later pass.
    await new WalletReturnInbox(storage).add({ kind: 'hashes', hashes: [hashOf('not-indexed-yet')] });
    window.history.replaceState(null, '', `/receipt/${ID}`);
    renderWithChain(<ReceiptScreen id={ID} />, { setup, adapter: recordingWallet(PAYER).adapter, storage });
    expect(await screen.findByText('Matching the transaction your wallet returned to this payment…')).toBeTruthy();
    expect(screen.getByText('Paid per contract')).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
  });

  it('a payment made elsewhere keeps the cross-device message', async () => {
    const { setup } = paidWorld();
    window.history.replaceState(null, '', `/receipt/${ID}`);
    renderWithChain(<ReceiptScreen id={ID} />, { setup, adapter: recordingWallet(null).adapter, storage: memoryStorage() });
    expect(await screen.findByText('Settlement proof not available on this device')).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
  });

  it('a forged ftx hint on a follow-up URL cannot produce Verified Paid', async () => {
    const { setup } = paidWorld();
    window.history.replaceState(null, '', `/receipt/${ID}?ftx=${hashOf('forged')}`);
    renderWithChain(<ReceiptScreen id={ID} />, { setup, adapter: recordingWallet(null).adapter, storage: memoryStorage() });
    expect(await screen.findByTestId('verification-failed')).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
  });
});
