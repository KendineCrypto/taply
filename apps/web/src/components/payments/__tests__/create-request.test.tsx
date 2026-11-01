import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateRequest } from '../CreateRequest';
import { installChain, memoryStorage, must, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { JOURNAL_STORAGE_KEY } from '@/lib/payments/journal';
import { IntentTermsSchema, calculateRequestId, calculateTermsHash } from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const CONTRACT = 'payments.taply-review.testnet';
const CREATOR = 'merchant.testnet';
const CHAIN_NOW = '1793476890000000000';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => push.mockReset());

async function fillAndReview(amount: string, extra: { memo?: string; payer?: string } = {}) {
  fireEvent.change(await screen.findByLabelText('Amount (NEAR)'), { target: { value: amount } });
  // Memo, payer and expiry are optional and live behind "More options".
  if (extra.memo !== undefined || extra.payer !== undefined) fireEvent.click(screen.getByRole('button', { name: /More options/ }));
  if (extra.memo !== undefined) fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: extra.memo } });
  if (extra.payer !== undefined) {
    fireEvent.change(screen.getByLabelText('Only this account may pay (optional)'), { target: { value: extra.payer } });
  }
  // The button stays disabled until get_config has been verified at a final block.
  const review = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
  await waitFor(() => expect(review.disabled).toBe(false));
  await act(async () => {
    fireEvent.click(review);
  });
}

describe('create request', () => {
  it('builds frozen-protocol terms from chain time, quotes them, and asks the wallet for the exact create call', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter, signed } = recordingWallet(CREATOR);
    const storage = memoryStorage();
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter, storage });

    await fillAndReview('1.5', { memo: 'Coffee ☕', payer: 'bob.testnet' });
    expect(await screen.findByText('Check before you sign')).toBeTruthy();
    expect(screen.getByText('1500000000000000000000000')).toBeTruthy(); // exact yocto
    expect(screen.getByText('Storage bond')).toBeTruthy();

    const quoted = must(chain.calls.find((c) => c.methodName === 'quote_create_request'), 'a quote call').args as { terms: IntentTerms };
    const terms = IntentTermsSchema.parse(quoted.terms);
    expect(terms).toMatchObject({
      schemaVersion: 'taply.intent.v1',
      network: 'near-testnet',
      contractId: CONTRACT,
      creatorAccountId: CREATOR,
      assetId: 'near:native',
      amountBaseUnits: '1500000000000000000000000',
      mode: 'instant',
      cancelDurationNs: null,
      permittedPayerAccountId: 'bob.testnet',
      merchantAccountId: null,
      memo: 'Coffee ☕',
      sessionBinding: null,
      // 15 minutes after the finalized block that verified the contract.
      fundingExpiresAtNs: (BigInt(CHAIN_NOW) + 900_000_000_000n).toString(),
    });
    expect(terms.creationNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(terms.id).toBe(calculateRequestId({ contractId: CONTRACT, creationNonce: terms.creationNonce, creatorAccountId: CREATOR, network: 'near-testnet' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' }));
    });
    expect(signed).toEqual([
      {
        signer: CREATOR,
        call: {
          receiverId: CONTRACT,
          methodName: 'create_request',
          args: { terms, quoteVersion: '1' },
          gas: '30000000000000',
          depositYocto: '5860000000000000000000',
        },
      },
    ]);
    // Journaled with the full terms (same nonce can be resumed), then status page.
    const entry = JSON.parse(must(storage.data.get(JOURNAL_STORAGE_KEY), 'a journal')).entries[0];
    expect(entry).toMatchObject({ method: 'create_request', requestId: terms.id, termsHash: calculateTermsHash(terms), phase: 'SUBMITTED' });
    expect(entry.terms).toEqual(terms);
    expect(push).toHaveBeenCalledWith(`/pay/${terms.id}`);
  });

  it('validates the form locally before any contract call', async () => {
    const chain = installChain({ contractId: CONTRACT });
    const { adapter } = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter });
    await fillAndReview('0.0000000000000000000000001', { payer: CREATOR });
    expect(screen.getByText('Use digits and one decimal point, with at most 24 decimal places.')).toBeTruthy();
    expect(screen.getByText('The payer cannot be you.')).toBeTruthy();
    expect(chain.calls.some((c) => c.methodName === 'quote_create_request')).toBe(false);
  });

  it('an unconfirmed earlier creation blocks a new one; the same terms can be resumed after the chain shows no effect', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const storage = memoryStorage();
    const first = recordingWallet(CREATOR, async () => ({ kind: 'unknown' }));
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter: first.adapter, storage });
    await fillAndReview('2');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Create request in wallet' }));
    });
    const original = (must(first.signed[0], 'a first signature').call.args as { terms: IntentTerms }).terms;
    cleanup();

    // Same chain time: the attempt is too recent to conclude anything.
    const second = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter: second.adapter, storage });
    const notice = (await screen.findByText('A request you started is still unconfirmed')).closest('[role="status"]') as HTMLElement;
    expect(within(notice).queryByRole('button', { name: 'Resume this request' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    // Later, still not on chain: the SAME terms (same nonce, same id) may be re-signed.
    chain.blockTimestampNs = (BigInt(Date.now()) * 1_000_000n + 300_000_000_000n).toString();
    const third = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter: third.adapter, storage });
    // Reconciliation is a full finalized read per unexplained attempt.
    const resume = await screen.findByRole('button', { name: 'Resume this request' }, { timeout: 4000 });
    await act(async () => {
      fireEvent.click(resume);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Create request in wallet' }));
    });
    expect((must(third.signed[0], 'a resumed signature').call.args as { terms: IntentTerms }).terms).toEqual(original);
  });

  it('asks a disconnected visitor to connect, and never signs with the gate off', async () => {
    const chain = installChain({ contractId: CONTRACT });
    const disconnected = recordingWallet(null);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter: disconnected.adapter });
    expect(await screen.findByText(/Connect your Testnet wallet to create a request/)).toBeTruthy();
    cleanup();

    const gated = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, false), adapter: gated.adapter });
    await fillAndReview('1');
    expect(await screen.findByText('Transactions are switched off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create request in wallet' })).toBeNull();
    expect(gated.signed).toHaveLength(0);
  });

  it('asks for the amount only; optional fields stay collapsed with safe defaults', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter } = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByLabelText('Amount (NEAR)')).toBeTruthy();
    // The only editable field at rest is the amount.
    expect(screen.queryByLabelText('Note (optional)')).toBeNull();
    expect(screen.queryByLabelText('Only this account may pay (optional)')).toBeNull();
    expect(screen.queryByLabelText('Payable for')).toBeNull();
    const toggle = screen.getByRole('button', { name: /More options/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Anyone can pay · payable for 15 minutes');
    // The recipient is the connected account: shown, never editable.
    expect(screen.getByText(CREATOR)).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Note (optional)')).toBeTruthy();
    expect(screen.getByLabelText('Only this account may pay (optional)')).toBeTruthy();
    expect((screen.getByLabelText('Payable for') as HTMLSelectElement).value).toBe('15m');
  });

  it('shows the exact terms, bond and network on review before the wallet is ever asked', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter, signed } = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter });
    await fillAndReview('0.1');
    const review = must((await screen.findByRole('heading', { name: 'Check before you sign' })).closest('section'), 'review');
    expect(within(review).getByText('Anyone may pay')).toBeTruthy();
    expect(within(review).getByText('Storage bond')).toBeTruthy();
    expect(within(review).getByText('0.00586')).toBeTruthy(); // exact bond from the quote
    expect(within(review).getByText('Payable until')).toBeTruthy();
    expect(within(review).getAllByText(/NEAR Testnet/).length).toBeGreaterThan(0);
    expect(within(review).getAllByText(CREATOR).length).toBeGreaterThan(0);
    expect(within(review).getByText('100000000000000000000000')).toBeTruthy(); // exact yocto in technical details
    expect(within(review).getByRole('button', { name: 'Create request in wallet' })).toBeTruthy();
    expect(signed).toHaveLength(0);
  });

  it('opens the optional settings when one of them is invalid', async () => {
    const chain = installChain({ contractId: CONTRACT });
    const { adapter } = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter });
    fireEvent.change(await screen.findByLabelText('Amount (NEAR)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /More options/ }));
    fireEvent.change(screen.getByLabelText('Only this account may pay (optional)'), { target: { value: CREATOR } });
    fireEvent.click(screen.getByRole('button', { name: /More options/ })); // collapsed again
    const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    await waitFor(() => expect(next.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(next);
    });
    expect(screen.getByRole('button', { name: /More options/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('The payer cannot be you.')).toBeTruthy();
    expect(chain.calls.some((c) => c.methodName === 'quote_create_request')).toBe(false);
  });
});
