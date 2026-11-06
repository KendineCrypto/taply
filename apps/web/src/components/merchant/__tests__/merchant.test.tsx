import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POS_SALES_KEY } from '@/lib/merchant/journey';
import { DiscoveryQr } from '../DiscoveryQr';
import { MerchantHome, SaleRegister } from '../MerchantScreens';
import { selectRecentSales } from '../RecentSales';
import { FIXTURES, installChain, memoryStorage, must, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { JOURNAL_STORAGE_KEY } from '@/lib/payments/journal';
import type { JournalEntry } from '@/lib/payments/journal';
import { IntentTermsSchema, calculateTermsHash } from '@/lib/protocol';
import type { ContractRequest } from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/merchant' }));

const CONTRACT = 'payments.taply-review.testnet';
const MERCHANT = 'merchant.testnet';
const CHAIN_NOW = '1793476890000000000';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  push.mockReset();
  window.localStorage.clear();
});

async function createSale(amount: string, reference: string) {
  fireEvent.change(await screen.findByLabelText('Amount (NEAR)'), { target: { value: amount } });
  // The sale reference is visible without opening "More options".
  fireEvent.change(screen.getByLabelText('Sale reference (optional)'), { target: { value: reference } });
  const review = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
  await waitFor(() => expect(review.disabled).toBe(false));
  await act(async () => {
    fireEvent.click(review);
  });
  await screen.findByText('Check before you sign');
}

describe('merchant POS (sale register)', () => {
  it('uses the existing create flow: Instant terms to the connected account, no merchant or session binding', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter, signed } = recordingWallet(MERCHANT);
    const storage = memoryStorage();
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter, storage });

    await createSale('2.5', 'Order 42');
    // Honest limitation is shown at review, before the wallet.
    expect(screen.getByText('Not a verified merchant checkout yet')).toBeTruthy();
    // No wallet prompt until the explicit button.
    expect(signed).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' }));
    });
    expect(signed).toHaveLength(1);
    const call = must(signed[0], 'one signature').call;
    expect(call.methodName).toBe('create_request');
    const terms = IntentTermsSchema.parse((call.args as { terms: IntentTerms }).terms);
    // Phase 7F wording hint: /pay will call it "Your sale". Not a journal, not an authority.
    expect(JSON.parse(window.localStorage.getItem(POS_SALES_KEY) ?? '[]')).toEqual([terms.id]);
    expect(terms).toMatchObject({
      creatorAccountId: MERCHANT,
      amountBaseUnits: '2500000000000000000000000',
      mode: 'instant',
      memo: 'Order 42',
      // The deployed contract rejects these; the POS must not set them.
      merchantAccountId: null,
      sessionBinding: null,
      permittedPayerAccountId: null,
    });
    // Same journal as personal requests.
    const entry = JSON.parse(must(storage.data.get(JOURNAL_STORAGE_KEY), 'journal')).entries[0];
    expect(entry).toMatchObject({ method: 'create_request', requestId: terms.id, signerAccountId: MERCHANT });
    expect(push).toHaveBeenCalledWith(`/pay/${terms.id}`);
  });

  it('every sale gets a fresh nonce and a unique request ID, even with identical amount and reference', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter, signed } = recordingWallet(MERCHANT);
    const ids: string[] = [];
    const nonces: string[] = [];
    for (let i = 0; i < 2; i++) {
      // A fresh journal each time: on one journal the existing guard (correctly)
      // blocks a new creation until the chain explains the previous one.
      renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter, storage: memoryStorage() });
      await createSale('1', 'Coffee');
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' }));
      });
      const terms = (must(signed[i], 'signature').call.args as { terms: IntentTerms }).terms;
      ids.push(terms.id);
      nonces.push(terms.creationNonce);
      cleanup();
    }
    expect(new Set(ids).size).toBe(2);
    expect(new Set(nonces).size).toBe(2);
  });

  it('an unconfirmed earlier sale blocks the next one on the same device (no second request on an unknown outcome)', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter, signed } = recordingWallet(MERCHANT);
    const storage = memoryStorage();
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter, storage });
    await createSale('1', 'A');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' }));
    });
    cleanup();
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter, storage });
    expect(await screen.findByText('Waiting for the previous sale')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(signed).toHaveLength(1);
  });

  it('the block is account-scoped, explains the pending sale, and lifts by itself once the chain confirms it (no reload)', async () => {
    const CHAIN_NOW = (BigInt(Date.now()) * 1_000_000n + 10_000_000_000n).toString();
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter, signed } = recordingWallet(MERCHANT);
    const storage = memoryStorage();
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter, storage });
    await createSale('1.25', 'Table 7');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' }));
    });
    const terms = (must(signed[0], 'signature').call.args as { terms: IntentTerms }).terms;
    cleanup();

    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter, storage });
    expect(await screen.findByText('Waiting for the previous sale')).toBeTruthy();
    expect(screen.getByText(/1\.25 NEAR · “Table 7”/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Check chain status' }).getAttribute('href')).toBe(`/pay/${terms.id}`);
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);

    // The chain now confirms the first sale: the automatic re-check lifts the block
    // and offers the open sale's QR. Still exactly one signature.
    const confirmed: ContractRequest = {
      ...FIXTURES.open,
      terms,
      termsHash: calculateTermsHash(terms),
      recipientAccountId: terms.creatorAccountId,
      createdAtNs: CHAIN_NOW,
    };
    chain.requests.set(terms.id, confirmed);
    expect(await screen.findByText('Sale ready for payment', {}, { timeout: 6000 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Show sale QR' }).getAttribute('href')).toBe(`/pay/${terms.id}`);
    expect(screen.queryByText('Waiting for the previous sale')).toBeNull();
    fireEvent.change(screen.getByLabelText('Amount (NEAR)'), { target: { value: '2' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false));
    // The second sale uses the SAME durable journal, after confirmed creation.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Check before you sign');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' })));
    expect(signed).toHaveLength(2);
    const secondTerms = (must(signed[1], 'second sale').call.args as { terms: IntentTerms }).terms;
    expect(secondTerms.id).not.toBe(terms.id);
    expect(secondTerms.creationNonce).not.toBe(terms.creationNonce);
    expect(secondTerms.creatorAccountId).toBe(MERCHANT);
    expect(JSON.parse(must(storage.data.get(JOURNAL_STORAGE_KEY), 'journal')).entries).toHaveLength(2);
    cleanup();

    // Another account on the same device is not blocked by this account's sales.
    const other = recordingWallet('other-shop.testnet');
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter: other.adapter, storage });
    await screen.findByLabelText('Amount (NEAR)');
    fireEvent.change(screen.getByLabelText('Amount (NEAR)'), { target: { value: '1' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText('Sale ready for payment')).toBeNull();
  }, 15000);

  it('an account switch during review drops the prepared sale: never shown as "you", never signed', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter, signed } = recordingWallet(MERCHANT);
    let emit: (session: { accountId: string; walletId: string; walletName: string } | null) => void = () => undefined;
    const switching = { ...adapter, subscribe: (listener: typeof emit) => ((emit = listener), () => undefined) };
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter: switching, storage: memoryStorage() });
    await createSale('3', 'Order 9');
    act(() => emit({ accountId: 'second-shop.testnet', walletId: 'fake', walletName: 'Fake Wallet' }));
    expect(await screen.findByText('Connected account changed')).toBeTruthy();
    expect(screen.getByText(/prepared for merchant\.testnet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create request in wallet' })).toBeNull();
    expect(screen.queryByText('Check before you sign')).toBeNull();
    // Back on the form for the new account; nothing was signed.
    expect(screen.getByText('second-shop.testnet')).toBeTruthy();
    expect(signed).toHaveLength(0);
  });

  it('asks for a wallet before showing the register', async () => {
    const chain = installChain({ contractId: CONTRACT });
    const { adapter } = recordingWallet(null);
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('Connect the NEAR Testnet wallet that should receive your sales.')).toBeTruthy();
    expect(screen.queryByLabelText('Amount (NEAR)')).toBeNull();
  });

  it('refuses a non-Testnet connected account', async () => {
    const chain = installChain({ contractId: CONTRACT });
    const { adapter } = recordingWallet('shop.near');
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('Not a NEAR Testnet account')).toBeTruthy();
    expect(screen.queryByLabelText('Amount (NEAR)')).toBeNull();
  });

  it('with the signing flag off, review is possible but the wallet is never offered', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: CHAIN_NOW });
    const { adapter, signed } = recordingWallet(MERCHANT);
    renderWithChain(<SaleRegister />, { setup: readySetup(chain, false), adapter });
    await createSale('1', '');
    expect(screen.queryByRole('button', { name: 'Create request in wallet' })).toBeNull();
    expect(signed).toHaveLength(0);
  });
});

describe('merchant home', () => {
  it('shows the exact receiving account; unimplemented capabilities are inert, not links', async () => {
    const chain = installChain({ contractId: CONTRACT });
    const { adapter } = recordingWallet(MERCHANT);
    renderWithChain(<MerchantHome />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('Receiving account')).toBeTruthy();
    expect(screen.getAllByText(MERCHANT).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /New sale/ }).getAttribute('href')).toBe('/merchant/register');
    expect(screen.getByRole('link', { name: /Store QR/ }).getAttribute('href')).toBe('/merchant/setup');
    expect(screen.queryByRole('link', { name: /Live Handshake/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Merchant profile/ })).toBeNull();
    // Phase 7G: one quiet inert row names both, with a single Coming later label.
    expect(screen.getAllByText('Coming later')).toHaveLength(1);
    const later = screen.getByTestId('merchant-coming-later');
    expect(later.textContent).toContain('Live Handshake');
    expect(later.textContent).toContain('Merchant profile');
    expect(later.querySelector('a, button')).toBeNull();
    expect(screen.getByText('No sales yet')).toBeTruthy();
    // No status claims anywhere on the hub.
    expect(screen.queryByText(/Verified Paid/)).toBeNull();
  });
});

describe('discovery QR', () => {
  it('draws the canonical discovery URL only, labelled as not a payment', async () => {
    vi.stubEnv('NEXT_PUBLIC_TAPLY_SHARE_ORIGIN', 'https://taply.app');
    const chain = installChain({ contractId: CONTRACT });
    const { adapter } = recordingWallet(MERCHANT);
    renderWithChain(<DiscoveryQr accountId={MERCHANT} />, { setup: readySetup(chain, true), adapter });
    const qr = await screen.findByRole('img', { name: /Store QR/ });
    expect(qr.getAttribute('aria-label')).toBe('Store QR: https://taply.app/checkout/merchant.testnet');
    expect(screen.getAllByText('Store page · not a payment').length).toBeGreaterThan(0);
    expect(screen.getByText('Profile not verified')).toBeTruthy();
  });

  it('shows no QR from a local-only address', async () => {
    const chain = installChain({ contractId: CONTRACT });
    const { adapter } = recordingWallet(MERCHANT);
    renderWithChain(<DiscoveryQr accountId={MERCHANT} />, { setup: readySetup(chain, true), adapter });
    expect(await screen.findByText('No shareable link from this address')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Store QR/ })).toBeNull();
  });
});

describe('recent sales selection', () => {
  const base = {
    network: 'near-testnet',
    contractId: CONTRACT,
    termsHash: 'c'.repeat(64),
    operationNonce: null,
    transactionHash: null,
    updatedAt: '2026-11-01T10:00:00.000Z',
  } as const;
  const terms = { memo: '', amountBaseUnits: '1' } as unknown as IntentTerms;
  const entry = (over: Partial<JournalEntry>): JournalEntry =>
    ({ ...base, method: 'create_request', requestId: 'a'.repeat(64), signerAccountId: MERCHANT, terms, phase: 'SUBMITTED', startedAt: '2026-11-01T10:00:00.000Z', ...over }) as JournalEntry;

  it('keeps only this account’s creations on this contract, newest first, excluding declines', () => {
    const list = [
      entry({ requestId: '1'.repeat(64), startedAt: '2026-11-01T09:00:00.000Z' }),
      entry({ requestId: '2'.repeat(64), startedAt: '2026-11-01T11:00:00.000Z' }),
      entry({ requestId: '3'.repeat(64), phase: 'USER_REJECTED' }),
      entry({ requestId: '4'.repeat(64), signerAccountId: 'other.testnet' }),
      entry({ requestId: '5'.repeat(64), method: 'pay_instant_native', terms: null }),
      entry({ requestId: '6'.repeat(64), contractId: 'old.testnet' }),
    ];
    expect(selectRecentSales(list, MERCHANT, CONTRACT).map((e) => e.requestId[0])).toEqual(['2', '1']);
  });
});
