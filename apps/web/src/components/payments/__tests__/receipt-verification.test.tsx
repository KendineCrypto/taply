import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptScreen } from '../ReceiptScreen';
import {
  CODE_HASH,
  FIXTURES,
  installChain,
  memoryStorage,
  readySetup,
  recordingWallet,
  renderWithChain,
} from '@/test/chain';
import { JOURNAL_STORAGE_KEY } from '@/lib/payments/journal';
import type { ContractRequest } from '@/lib/protocol';
import { buildPaidChain, outcomes } from '@/lib/verify/__tests__/fake-chain';

/**
 * Receipt screen + independent verifier. Contract reads go through the real
 * near-client against the fake JSON-RPC (src/test/chain.tsx); the verifier reads
 * a synthetic receipt graph (lib/verify/__tests__/fake-chain.ts). Neither is
 * Testnet evidence.
 */

const { paidRestricted, paidAfterRetry } = FIXTURES;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function setupFor(
  request: ContractRequest,
  opts: {
    verifier?: boolean;
    tamper?: (v: ReturnType<typeof buildPaidChain>) => void;
  } = {},
) {
  const chain = installChain({ contractId: request.terms.contractId });
  chain.requests.set(request.terms.id, request);
  const verifierChain = buildPaidChain(request);
  verifierChain.chain.defaultCodeHash = CODE_HASH; // the harness pins this code hash
  opts.tamper?.(verifierChain);
  const setup = readySetup(chain, false, CODE_HASH, opts.verifier === false ? null : verifierChain.input.rpc);
  return { setup, verifierChain };
}

function journalWith(request: ContractRequest, hash: string) {
  const storage = memoryStorage();
  const at = '2026-11-01T10:00:00.000Z';
  storage.setItem(
    JOURNAL_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      entries: [
        {
          method: 'pay_instant_native',
          network: 'near-testnet',
          contractId: request.terms.contractId,
          requestId: request.terms.id,
          termsHash: request.termsHash,
          signerAccountId: request.payerAccountId,
          terms: null,
          operationNonce: null,
          phase: 'RESOLVED',
          transactionHash: hash,
          startedAt: at,
          updatedAt: at,
        },
      ],
    }),
  );
  return storage;
}

describe('receipt verification on /receipt/[id]', () => {
  it('shows Verified Paid only after the verifier confirms the receipts (journal hash)', async () => {
    const { setup, verifierChain } = setupFor(paidRestricted);
    const storage = journalWith(paidRestricted, verifierChain.input.fundingTransaction.hash);
    renderWithChain(<ReceiptScreen id={paidRestricted.terms.id} />, {
      setup,
      adapter: recordingWallet(null).adapter,
      storage,
    });

    expect(await screen.findByTestId('verified-evidence')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Verified Paid' })).toBeTruthy();
    expect(document.querySelector('[data-receipt-status="verified"]')).not.toBeNull();
    expect(screen.queryByText('Paid per contract')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy verification link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy receipt evidence (JSON)' })).toBeTruthy();
    expect(screen.getByText('fake-testnet')).toBeTruthy();
  });

  it('verifies from a shared verification link with a retry (?ftx=&rtx=)', async () => {
    const { setup, verifierChain } = setupFor(paidAfterRetry);
    const retry = verifierChain.input.retryTransactions[0]?.hash ?? '';
    window.history.replaceState(
      null,
      '',
      `/receipt/${paidAfterRetry.terms.id}?ftx=${verifierChain.input.fundingTransaction.hash}&rtx=${retry}`,
    );
    renderWithChain(<ReceiptScreen id={paidAfterRetry.terms.id} />, {
      setup,
      adapter: recordingWallet(null).adapter,
    });

    expect(await screen.findByTestId('verified-evidence')).toBeTruthy();
    expect(screen.getByText('Payout transaction')).toBeTruthy();
  });

  it('without any transaction hash stays "Paid per contract" and never verified', async () => {
    const { setup } = setupFor(paidRestricted);
    renderWithChain(<ReceiptScreen id={paidRestricted.terms.id} />, {
      setup,
      adapter: recordingWallet(null).adapter,
    });

    expect(await screen.findByText('Settlement proof not available on this device')).toBeTruthy();
    expect(screen.getByText('Paid per contract')).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Verified Paid' })).toBeNull();
    expect(document.querySelector('[data-receipt-status="contract_paid"]')).not.toBeNull();
  });

  it('a tampered receipt graph shows a mismatch warning, not Verified Paid', async () => {
    const { setup, verifierChain } = setupFor(paidRestricted, {
      tamper: (v) => {
        const tx = v.chain.txs.get(v.input.fundingTransaction.hash) as Record<string, unknown>;
        for (const o of outcomes(tx)) {
          const inner = o['outcome'] as Record<string, unknown>;
          if (inner['executor_id'] === paidRestricted.recipientAccountId) inner['status'] = { Failure: {} };
        }
      },
    });
    const storage = journalWith(paidRestricted, verifierChain.input.fundingTransaction.hash);
    renderWithChain(<ReceiptScreen id={paidRestricted.terms.id} />, {
      setup,
      adapter: recordingWallet(null).adapter,
      storage,
    });

    expect(await screen.findByText('Receipt evidence does not match')).toBeTruthy();
    expect(screen.getByText('TRANSFER_MISMATCH')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Verified Paid' })).toBeNull();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
    expect(screen.getByText('Paid per contract')).toBeTruthy();
  });

  it('a forged link hash cannot verify', async () => {
    const { setup } = setupFor(paidRestricted);
    window.history.replaceState(null, '', `/receipt/${paidRestricted.terms.id}?ftx=11111111111111111111111111111119`);
    renderWithChain(<ReceiptScreen id={paidRestricted.terms.id} />, {
      setup,
      adapter: recordingWallet(null).adapter,
    });

    expect(await screen.findByText('Could not verify yet')).toBeTruthy();
    expect(screen.getByText('TRANSACTION_NOT_FOUND')).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
  });

  it('without a verifier RPC says so and shows contract state only', async () => {
    const { setup, verifierChain } = setupFor(paidRestricted, {
      verifier: false,
    });
    const storage = journalWith(paidRestricted, verifierChain.input.fundingTransaction.hash);
    renderWithChain(<ReceiptScreen id={paidRestricted.terms.id} />, {
      setup,
      adapter: recordingWallet(null).adapter,
      storage,
    });

    expect(await screen.findByText('Verification not available')).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
  });
});
