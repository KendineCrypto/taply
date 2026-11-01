import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentScreen } from '../PaymentScreen';
import { ReceiptScreen } from '../ReceiptScreen';
import { BLOCK_HASH, FIXTURES, OTHER_CODE_HASH, must, configFor, installChain, memoryStorage, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { JOURNAL_STORAGE_KEY } from '@/lib/payments/journal';
import type { ContractRequest } from '@/lib/protocol';

/**
 * Integration: PaymentScreen -> real @taply/near-client -> JSON-RPC wire format,
 * fed with real sandbox contract outputs. The wallet is a recorder: the tests
 * assert exactly what the person would be asked to sign, and that nothing is
 * asked when any gate is closed.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { openRestricted, paidRestricted, open, cancelled, failed, paidAfterRetry, inFlight } = FIXTURES;
const PAYER = must(openRestricted.terms.permittedPayerAccountId, 'a payer restriction');
const RECIPIENT = openRestricted.recipientAccountId;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  push.mockReset();
  window.sessionStorage.clear();
});

function chainWith(request: ContractRequest, blockTimestampNs?: string) {
  const chain = installChain({ contractId: request.terms.contractId, ...(blockTimestampNs ? { blockTimestampNs } : {}) });
  chain.requests.set(request.terms.id, request);
  return chain;
}

describe('payer review and wallet approval', () => {
  it('shows exact terms, requires an explicit check, then asks the wallet for exactly the ABI call', async () => {
    const chain = chainWith(openRestricted);
    const { adapter, signed } = recordingWallet(PAYER);
    const storage = memoryStorage();
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter, storage });

    const review = must((await screen.findByRole('heading', { name: 'Review payment' })).closest('section'), 'the review section');
    expect(within(review).getByText(RECIPIENT)).toBeTruthy();
    expect(screen.getAllByText('1').length).toBeGreaterThan(0); // 1 NEAR, exact
    expect(screen.getByText('1000000000000000000000000')).toBeTruthy(); // exact yoctoNEAR
    const approve = await within(review).findByRole('button', { name: 'Approve in wallet' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(review).getByLabelText('I checked the recipient account and the amount.'));
    expect((approve as HTMLButtonElement).disabled).toBe(false);

    // The contract records the payment; the next finalized read shows it.
    chain.requests.set(openRestricted.terms.id, paidRestricted);
    await act(async () => {
      fireEvent.click(approve);
    });

    expect(signed).toEqual([
      {
        signer: PAYER,
        call: {
          receiverId: openRestricted.terms.contractId,
          methodName: 'pay_instant_native',
          args: { id: openRestricted.terms.id, expectedTermsHash: openRestricted.termsHash },
          gas: '50000000000000',
          depositYocto: '1000000000000000000000000',
        },
      },
    ]);
    // Journaled before the wallet opened, with the hash the wallet returned.
    const journal = JSON.parse(must(storage.data.get(JOURNAL_STORAGE_KEY), 'a journal'));
    expect(journal.entries[0]).toMatchObject({ method: 'pay_instant_native', requestId: openRestricted.terms.id, phase: expect.stringMatching(/SUBMITTED|RESOLVED/) });

    // Paid per contract - never the Verified Paid ribbon (no receipt verifier yet).
    expect(await screen.findAllByText('Paid per contract')).not.toHaveLength(0);
    expect(screen.queryByText('Verified')).toBeNull();
    expect(screen.getByText(/Open the receipt to check them/)).toBeTruthy();
    // Phase 6A: the receipt opens once by itself, carrying this device's funding hash,
    // so the independent verifier starts without the person doing anything.
    const receipt = `/receipt/${openRestricted.terms.id}?ftx=${BLOCK_HASH}`;
    expect(screen.getByRole('link', { name: 'View receipt' }).getAttribute('href')).toBe(receipt);
    await waitFor(() => expect(push).toHaveBeenCalledWith(receipt));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('with the signing gate off: full review, no approve control, the wallet is never asked', async () => {
    const chain = chainWith(openRestricted);
    const { adapter, signed } = recordingWallet(PAYER);
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, false), adapter });
    expect(await screen.findByText('Transactions are switched off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve in wallet' })).toBeNull();
    expect(signed).toHaveLength(0);
  });

  it('an unknown wallet outcome blocks paying again until the chain explains it', async () => {
    const chain = chainWith(openRestricted);
    const { adapter, signed } = recordingWallet(PAYER, async () => ({ kind: 'unknown' }));
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter });
    fireEvent.click(await screen.findByLabelText('I checked the recipient account and the amount.'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve in wallet' }));
    });
    expect(await screen.findByText('Result unknown')).toBeTruthy();
    // Chain still says OPEN: the attempt is unexplained, so there is no pay button.
    expect(await screen.findByText('An earlier attempt is still unexplained')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve in wallet' })).toBeNull();
    expect(signed).toHaveLength(1);
  });

  it('a declined signature sends nothing and allows a deliberate new attempt', async () => {
    const chain = chainWith(openRestricted);
    const { WalletError } = await import('@/lib/wallet/adapter');
    const { adapter } = recordingWallet(PAYER, async () => {
      throw new WalletError('cancelled');
    });
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter });
    fireEvent.click(await screen.findByLabelText('I checked the recipient account and the amount.'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve in wallet' }));
    });
    expect(await screen.findByText('Declined in your wallet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve in wallet' })).toBeTruthy();
  });

  it('refuses a payer the terms do not permit, without asking the wallet', async () => {
    const chain = chainWith(openRestricted);
    const { adapter, signed } = recordingWallet('someone-else.testnet');
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('Your account may not pay this request')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve in wallet' })).toBeNull();
    expect(signed).toHaveLength(0);
  });

  it('an expired request shows no pay control (chain time, not browser time)', async () => {
    const chain = chainWith(open, '1793476906102821508'); // exactly fundingExpiresAtNs
    const { adapter } = recordingWallet('payer.testnet');
    renderWithChain(<PaymentScreen id={open.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('This request expired')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Review payment' })).toBeNull();
  });
});

describe('recipient view', () => {
  it('OPEN: share link and scannable QR of the same link, plus creator-only cancel', async () => {
    const chain = chainWith(open);
    const { adapter, signed } = recordingWallet(open.recipientAccountId);
    // The page runs on http://localhost (jsdom); the operator set a public HTTPS share origin.
    vi.stubEnv('NEXT_PUBLIC_TAPLY_SHARE_ORIGIN', 'https://pilot.taply.app');
    renderWithChain(<PaymentScreen id={open.terms.id} />, { setup: readySetup(chain, true), adapter });
    const link = await screen.findByTestId('pay-link');
    expect(link.textContent).toBe(`https://pilot.taply.app/pay/${open.terms.id}`);
    expect(screen.getByRole('img', { name: `QR code for the payment link: ${link.textContent}` })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Review payment' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel request in wallet' }));
    chain.requests.set(open.terms.id, cancelled);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel this unpaid request' }));
    });
    expect(signed[0]?.call).toEqual({
      receiverId: open.terms.contractId,
      methodName: 'cancel_unfunded',
      args: { id: open.terms.id, expectedTermsHash: open.termsHash },
      gas: '15000000000000',
      depositYocto: '1',
    });
    // Shown by the progress hero and by the contract-status chip.
    expect((await screen.findAllByText('Cancelled')).length).toBeGreaterThan(0);
  });

  it('PAYOUT_FAILED_RECOVERABLE: only the recipient gets a same-nonce retry', async () => {
    const chain = chainWith(failed, '1793476909000000000');
    const { adapter, signed } = recordingWallet(failed.recipientAccountId);
    renderWithChain(<PaymentScreen id={failed.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText(/You can retry the same transfer/)).toBeTruthy();
    chain.requests.set(failed.terms.id, paidAfterRetry);
    chain.blockTimestampNs = '1793476910000000000';
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry transfer in wallet' }));
    });
    expect(signed[0]?.call).toEqual({
      receiverId: failed.terms.contractId,
      methodName: 'retry_native_transfer',
      args: { id: failed.terms.id, expectedOperationNonce: '1' },
      gas: '50000000000000',
      depositYocto: '1',
    });
    expect(await screen.findAllByText('Paid per contract')).not.toHaveLength(0);
  });

  it('PAYOUT_FAILED_RECOVERABLE: the payer sees why, and has no retry', async () => {
    const chain = chainWith(failed, '1793476909000000000');
    const { adapter, signed } = recordingWallet(failed.payerAccountId);
    renderWithChain(<PaymentScreen id={failed.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText(/Only the recipient can retry it/)).toBeTruthy();
    // Funded: the funding deadline no longer applies; operation status is localised, not a raw enum.
    expect(screen.queryByText('Payable until (chain time)')).toBeNull();
    expect(screen.getByText('#1 · failed, recorded')).toBeTruthy();
    expect(screen.queryByText(/FAILED/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry transfer in wallet' })).toBeNull();
    expect(signed).toHaveLength(0);
  });
});

describe('in-flight and unresolved transfers', () => {
  it('PAYOUT_IN_FLIGHT shows the exact state and offers no financial action', async () => {
    const chain = chainWith(inFlight, '1793476869000000000');
    const { adapter, signed } = recordingWallet(inFlight.payerAccountId);
    renderWithChain(<PaymentScreen id={inFlight.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('Processing on chain')).toBeTruthy();
    expect(screen.getAllByText(/Do not pay again/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /wallet/i })).toBeNull();
    expect(signed).toHaveLength(0);
  });

  it('an in-flight transfer older than 5 minutes of chain time is reported unresolved, never retried', async () => {
    const chain = chainWith(inFlight, '1793477268394800946'); // startedAtNs + 400 s
    const { adapter } = recordingWallet(inFlight.recipientAccountId);
    renderWithChain(<PaymentScreen id={inFlight.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('Transfer unresolved')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

describe('fail closed', () => {
  it('a contract code hash that differs from the approved pin shows nothing from it', async () => {
    const chain = chainWith(openRestricted);
    chain.codeHash = OTHER_CODE_HASH;
    const { adapter } = recordingWallet(PAYER);
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect((await screen.findAllByText('Contract code does not match')).length).toBeGreaterThan(0);
    expect(screen.queryByText(RECIPIENT)).toBeNull();
    expect(chain.calls.some((c) => c.methodName === 'get_request')).toBe(false);
  });

  it('a test fault build is rejected and signing never becomes available', async () => {
    const chain = chainWith(openRestricted);
    chain.config = configFor(openRestricted.terms.contractId, { testFaultBuild: true });
    const { adapter, signed } = recordingWallet(PAYER);
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('This contract is not approved for payments')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve in wallet' })).toBeNull());
    expect(signed).toHaveLength(0);
  });

  it('not configured, malformed id, unknown id', async () => {
    const { adapter } = recordingWallet(PAYER);
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: { status: 'not_configured' }, adapter });
    expect(await screen.findByText('Payments are not set up')).toBeTruthy();
    cleanup();
    const chain = installChain({ contractId: openRestricted.terms.contractId });
    renderWithChain(<PaymentScreen id="not-a-request" />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('Not a request link')).toBeTruthy();
    cleanup();
    renderWithChain(<PaymentScreen id={'ab'.repeat(32)} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('No such request')).toBeTruthy();
  });

  it('renders in Turkish', async () => {
    const chain = chainWith(inFlight, '1793476869000000000');
    const { adapter } = recordingWallet(null);
    renderWithChain(<PaymentScreen id={inFlight.terms.id} />, { setup: readySetup(chain, true), adapter, locale: 'tr' });
    expect(await screen.findByText('Zincirde işleniyor')).toBeTruthy();
  });
});

describe('receipt', () => {
  it('FINAL_PAID shows contract terminal facts, labelled as not finality proof', async () => {
    const chain = chainWith(paidRestricted, '1793476890000000000');
    const { adapter } = recordingWallet(null);
    renderWithChain(<ReceiptScreen id={paidRestricted.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('Contract terminal facts')).toBeTruthy();
    expect(screen.getByText(/not an independently verified receipt/)).toBeTruthy();
    expect(screen.getByText('Payout confirmed by the contract callback')).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('a non-terminal request has no receipt', async () => {
    const chain = chainWith(inFlight, '1793476869000000000');
    const { adapter } = recordingWallet(null);
    renderWithChain(<ReceiptScreen id={inFlight.terms.id} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('No receipt yet')).toBeTruthy();
  });
});
