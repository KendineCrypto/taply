import { act, cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentScreen } from '../PaymentScreen';
import { FIXTURES, installChain, must, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { CHECKOUT_HINT_KEY, POS_SALES_KEY, groupCode, saleCode } from '@/lib/merchant/journey';
import type { ContractRequest } from '@/lib/protocol';

/**
 * Phase 7F shared payment journey on /pay/<id>: both phones see the same
 * amount, receiving account, sale code and timeline; each side gets its own
 * headline; the receiver of an open request watches the chain by itself.
 * Nothing here may show presence, a paid state or Verified Paid that the
 * chain and the independent verifier did not establish.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { openRestricted, paidRestricted } = FIXTURES;
const ID = openRestricted.terms.id;
const MERCHANT = openRestricted.recipientAccountId;
const CUSTOMER = must(openRestricted.terms.permittedPayerAccountId, 'a permitted payer');
const CODE = groupCode(must(saleCode(ID), 'a sale code'));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function chainWith(request: ContractRequest) {
  const chain = installChain({ contractId: request.terms.contractId });
  chain.requests.set(request.terms.id, request);
  return chain;
}

const hero = async () => must((await screen.findByTestId('journey-counterpart')).closest('section'), 'the journey hero');
const getRequestReads = (chain: ReturnType<typeof installChain>) => chain.calls.filter((c) => c.methodName === 'get_request').length;

describe('merchant phone (receiver)', () => {
  it('a POS sale: ready state with QR and code, then moves to Paid per contract by itself, never Verified Paid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubEnv('NEXT_PUBLIC_TAPLY_SHARE_ORIGIN', 'https://pilot.taply.app');
    window.localStorage.setItem(POS_SALES_KEY, JSON.stringify([ID]));
    const chain = chainWith(openRestricted);
    const { adapter, signed } = recordingWallet(MERCHANT);
    renderWithChain(<PaymentScreen id={ID} />, { setup: readySetup(chain, true), adapter });

    const section = await hero();
    expect(within(section).getByText('Your sale')).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Ready for the customer' })).toBeTruthy();
    expect(within(section).getByText('Live')).toBeTruthy();
    expect(within(section).getByText('No payment on chain yet')).toBeTruthy();
    expect(within(section).getByText(/Live customer presence needs Handshake/)).toBeTruthy();
    // The QR ticket carries the amount and the code; the hero does not repeat them.
    expect(await screen.findByTestId('pay-link')).toBeTruthy();
    const ticketCode = must(screen.getByTestId('sale-code').textContent, 'code text');
    expect(ticketCode).toContain(CODE);
    expect(section.getAttribute('data-live')).toBe('true');

    // The customer pays on their phone. No tap here: the live watch re-reads the chain.
    const before = getRequestReads(chain);
    chain.requests.set(ID, paidRestricted);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(getRequestReads(chain)).toBeGreaterThan(before);
    const paid = await hero();
    expect(within(paid).getByRole('heading', { name: 'Paid per contract' })).toBeTruthy();
    expect(within(paid).getByTestId('proof-legend').textContent).toContain('Verified Paid: Not checked on this screen');
    expect(paid.getAttribute('data-tone')).not.toBe('success');
    expect(paid.getAttribute('data-live')).toBeNull();
    expect(within(paid).getByText(`Paid by ${CUSTOMER}`)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Verified Paid|Independently verified/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'New sale' }).getAttribute('href')).toBe('/merchant/register');
    expect(signed).toHaveLength(0);
  });

  it('an ordinary request (not from the POS) uses neutral wording and offers no New sale', async () => {
    const chain = chainWith(paidRestricted);
    const { adapter } = recordingWallet(MERCHANT);
    renderWithChain(<PaymentScreen id={ID} />, { setup: readySetup(chain, true), adapter });
    const section = await hero();
    expect(within(section).getByText('Your request')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'New sale' })).toBeNull();
  });
});

describe('customer phone (payer)', () => {
  it('from this account’s checkout: live checkout wording, the SAME sale code, review below', async () => {
    window.sessionStorage.setItem(CHECKOUT_HINT_KEY, JSON.stringify({ accountId: MERCHANT, at: Date.now() }));
    const chain = chainWith(openRestricted);
    const { adapter, signed } = recordingWallet(CUSTOMER);
    renderWithChain(<PaymentScreen id={ID} />, { setup: readySetup(chain, true), adapter });

    const section = await hero();
    expect(within(section).getByText('Live checkout')).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Merchant is ready' })).toBeTruthy();
    expect(within(section).getByText('Signed on chain by the receiving account')).toBeTruthy();
    expect(within(section).getByTestId('sale-code').textContent).toContain(CODE);
    expect(within(section).getByText(MERCHANT)).toBeTruthy();
    expect(section.getAttribute('data-live')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Review payment' })).toBeTruthy();
    expect(signed).toHaveLength(0);
  });

  it('a checkout visit for ANOTHER account never frames this request as that checkout', async () => {
    window.sessionStorage.setItem(CHECKOUT_HINT_KEY, JSON.stringify({ accountId: 'someone-else.testnet', at: Date.now() }));
    const chain = chainWith(openRestricted);
    const { adapter } = recordingWallet(CUSTOMER);
    renderWithChain(<PaymentScreen id={ID} />, { setup: readySetup(chain, true), adapter });
    const section = await hero();
    expect(within(section).getByText('Payment request')).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Ready to pay' })).toBeTruthy();
    expect(within(section).queryByText('Live checkout')).toBeNull();
  });

  it('the payer side does not live-poll an open request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const chain = chainWith(openRestricted);
    const { adapter } = recordingWallet(CUSTOMER);
    renderWithChain(<PaymentScreen id={ID} />, { setup: readySetup(chain, true), adapter });
    await hero();
    const before = getRequestReads(chain);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(getRequestReads(chain)).toBe(before);
  });
});

describe('honesty', () => {
  it.each([
    ['merchant', MERCHANT, openRestricted],
    ['merchant', MERCHANT, paidRestricted],
    ['customer', CUSTOMER, openRestricted],
    ['customer', CUSTOMER, paidRestricted],
  ] as const)('%s view of %#: no live presence claim, no verified headline', async (_side, account, request) => {
    window.localStorage.setItem(POS_SALES_KEY, JSON.stringify([ID]));
    const chain = chainWith(request);
    const { adapter } = recordingWallet(account);
    renderWithChain(<PaymentScreen id={ID} />, { setup: readySetup(chain, true), adapter });
    const section = await hero();
    expect(section.textContent).not.toMatch(/joined|is here|connected|online/i);
    expect(section.getAttribute('data-tone')).not.toBe('success');
    expect(within(section).queryByRole('heading', { name: /Verified/ })).toBeNull();
  });
});
