import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutView } from '../CheckoutView';
import { installChain, readySetup, recordingWallet, renderWithChain } from '@/test/chain';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/checkout/shop.testnet' }));

const CONTRACT = 'payments.taply-review.testnet';
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';

afterEach(() => cleanup());
beforeEach(() => push.mockReset());

function renderCheckout(accountId: string, wallet: string | null = 'customer.testnet') {
  const chain = installChain({ contractId: CONTRACT });
  const recorded = recordingWallet(wallet);
  renderWithChain(<CheckoutView accountId={accountId} />, { setup: readySetup(chain, true), adapter: recorded.adapter });
  return { chain, ...recorded };
}

describe('customer checkout (discovery)', () => {
  it('shows the exact account and a discovery state: no amount, no name claim, no wallet, no chain write', async () => {
    const { signed, chain } = renderCheckout('shop.testnet');
    expect(await screen.findByText('Waiting for a sale')).toBeTruthy();
    expect(screen.getAllByText('shop.testnet').length).toBeGreaterThan(0);
    expect(screen.getByText('Business identity not verified.')).toBeTruthy();
    expect(screen.getByText('Check the account')).toBeTruthy();
    expect(screen.queryByText(/NEAR$/)).toBeNull(); // no amount shown
    expect(screen.queryByText(/Verified|Paid/)).toBeNull();
    expect(screen.queryByText(/merchant verified/i)).toBeNull();
    expect(signed).toHaveLength(0);
    // Only background contract verification reads; nothing is quoted, created or paid.
    const methods = chain.calls.map((c) => (c as { methodName?: string }).methodName);
    for (const write of ['quote_create_request', 'create_request', 'pay_instant_native']) expect(methods).not.toContain(write);
  });

  it('refuses invalid and non-Testnet accounts with an explanation', async () => {
    renderCheckout('shop.near');
    expect(await screen.findByText('Not a NEAR Testnet account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Scan sale QR' })).toBeNull();
    cleanup();
    renderCheckout('Bad..Account');
    expect(await screen.findByText('This is not a valid account')).toBeTruthy();
  });

  it('a pasted sale link opens that request; a pasted discovery link opens that checkout', async () => {
    renderCheckout('shop.testnet');
    fireEvent.click(await screen.findByRole('button', { name: 'Paste sale link' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: ID } });
    await act(async () => {
      fireEvent.submit(input.closest('form') as HTMLFormElement);
    });
    expect(push).toHaveBeenCalledWith(`/pay/${ID}`);
    fireEvent.change(input, { target: { value: `${window.location.origin}/checkout/other.testnet?to=evil.testnet` } });
    await act(async () => {
      fireEvent.submit(input.closest('form') as HTMLFormElement);
    });
    expect(push).toHaveBeenLastCalledWith('/checkout/other.testnet');
  });

  it('the merchant viewing their own page gets a shortcut to the POS', async () => {
    renderCheckout('shop.testnet', 'shop.testnet');
    expect(await screen.findByText('This is your checkout page')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New sale' }).getAttribute('href')).toBe('/merchant/register');
  });

  it('renders in Turkish', async () => {
    const chain = installChain({ contractId: CONTRACT });
    const { adapter } = recordingWallet(null);
    renderWithChain(<CheckoutView accountId="shop.testnet" />, { setup: readySetup(chain, true), adapter, locale: 'tr' });
    expect(await screen.findByText('Satış bekleniyor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Satış QR’ını okut' })).toBeTruthy();
  });
});
