import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptScreen } from '../ReceiptScreen';
import { CODE_HASH, FIXTURES, installChain, memoryStorage, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import type { ContractRequest } from '@/lib/protocol';
import type { PaymentsSetup } from '@/lib/payments/context';
import { buildPaidChain } from '@/lib/verify/__tests__/fake-chain';
import { buildLocatorChain, fakeLocatorRpc, payCall } from '@/lib/verify/__tests__/fake-locator';

/**
 * Phase 7G Stage 5: the merchant's phone reaches Verified Paid without the
 * customer's link, by locating the funding transaction from (synthetic) chain
 * data and handing it to the unchanged independent verifier. The verifier
 * decides; a located hash is only a candidate. Synthetic chains only.
 */

const paid = FIXTURES.paidRestricted;

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

function merchantSetup(request: ContractRequest, opts: { locatedHash?: string | null; locator?: boolean; pruned?: boolean } = {}) {
  const chain = installChain({ contractId: request.terms.contractId });
  chain.requests.set(request.terms.id, request);
  const verifierChain = buildPaidChain(request);
  verifierChain.chain.defaultCodeHash = CODE_HASH;
  const locatorChain = buildLocatorChain({ fundedAtNs: request.fundedAtNs ?? '0', fundingHeight: 5_000 });
  const hash = opts.locatedHash === undefined ? verifierChain.input.fundingTransaction.hash : opts.locatedHash;
  if (hash !== null) {
    locatorChain.txs.set(4_999, [
      { hash, signer_id: request.payerAccountId ?? '', receiver_id: request.terms.contractId, actions: [payCall(request.terms.id)] },
    ]);
  }
  if (opts.pruned === true) locatorChain.prunedBelow = 5_400;
  const base = readySetup(chain, false, CODE_HASH, verifierChain.input.rpc);
  if (base.status !== 'ready') throw new Error('ready setup required');
  const setup: PaymentsSetup = { ...base, locatorRpc: opts.locator === false ? null : fakeLocatorRpc(locatorChain) };
  return { setup, verifierChain, locatorChain };
}

// The merchant's phone: the recipient is connected, and its journal has no funding hash.
const merchantWallet = () => recordingWallet(paid.recipientAccountId).adapter;

describe('merchant-side Verified Paid without the customer link', () => {
  it('locates the funding transaction on chain, then the verifier confirms Verified Paid', async () => {
    const { setup, locatorChain } = merchantSetup(paid);
    renderWithChain(<ReceiptScreen id={paid.terms.id} />, { setup, adapter: merchantWallet(), storage: memoryStorage() });

    expect(await screen.findByTestId('verified-evidence', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Verified Paid' })).toBeTruthy();
    expect(screen.getByTestId('located-note').textContent).toContain('No link from the customer was needed');
    expect(new Set(locatorChain.calls)).toEqual(new Set(['block', 'chunk']));
  });

  it('a located hash that is not the real funding transaction never becomes Verified Paid', async () => {
    // Shaped like a funding call, but the verifier's chain has no such transaction.
    const { setup } = merchantSetup(paid, { locatedHash: '9x5BWFTV7ZcFDXxHyLsdNFHD5KQdXLfwQdgs6GPdShfJ' });
    renderWithChain(<ReceiptScreen id={paid.terms.id} />, { setup, adapter: merchantWallet(), storage: memoryStorage() });

    expect(await screen.findByTestId('verification-failed', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
    expect(document.querySelector('[data-receipt-status="contract_paid"]')).not.toBeNull();
  });

  it('nothing found on chain: stays Paid per contract, says why, offers Search again', async () => {
    const { setup } = merchantSetup(paid, { locatedHash: null });
    renderWithChain(<ReceiptScreen id={paid.terms.id} />, { setup, adapter: merchantWallet(), storage: memoryStorage() });

    const outcome = await screen.findByTestId('locator-outcome', {}, { timeout: 5000 });
    expect(outcome.getAttribute('data-kind')).toBe('not_found');
    expect(screen.getByText('Payment not found on chain from here')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search again' })).toBeTruthy();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
    expect(document.querySelector('[data-receipt-status="contract_paid"]')).not.toBeNull();
  });

  it('pruned history is explained, with no retry loop and no Verified Paid', async () => {
    const { setup } = merchantSetup(paid, { pruned: true });
    renderWithChain(<ReceiptScreen id={paid.terms.id} />, { setup, adapter: merchantWallet(), storage: memoryStorage() });

    const outcome = await screen.findByTestId('locator-outcome', {}, { timeout: 5000 });
    expect(outcome.getAttribute('data-kind')).toBe('history_unavailable');
    expect(screen.queryByRole('button', { name: 'Search again' })).toBeNull();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
  });

  it('a verification link wins: the locator does not run at all', async () => {
    const { setup, verifierChain, locatorChain } = merchantSetup(paid);
    window.history.replaceState(null, '', `/receipt/${paid.terms.id}?ftx=${verifierChain.input.fundingTransaction.hash}`);
    renderWithChain(<ReceiptScreen id={paid.terms.id} />, { setup, adapter: merchantWallet(), storage: memoryStorage() });

    expect(await screen.findByTestId('verified-evidence', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('located-note')).toBeNull();
    expect(locatorChain.calls).toEqual([]);
  });

  it('without a locator in this build the old honest state remains', async () => {
    const { setup } = merchantSetup(paid, { locator: false });
    renderWithChain(<ReceiptScreen id={paid.terms.id} />, { setup, adapter: merchantWallet(), storage: memoryStorage() });

    expect(await screen.findByText(/Paid per contract/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('locator-progress')).toBeNull();
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
  });
});
