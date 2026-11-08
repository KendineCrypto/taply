import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReceiptTicket } from '../ReceiptTicket';
import { I18nProvider } from '@/lib/i18n/provider';

/** Presentation only: the caller decides `status` from the independent verifier. */

const BASE: ComponentProps<typeof ReceiptTicket> = {
  status: 'verified',
  amountBaseUnits: '100000000000000000000000',
  recipientAccountId: 'taplytest.testnet',
  payerAccountId: 'payer.testnet',
  memo: '',
  settledAtNs: '1793476890000000000',
  references: [{ label: 'Funding transaction', value: 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su', transaction: true }],
  explorerBaseUrl: 'https://testnet.nearblocks.io',
  checkedVia: 'fastnear-testnet',
};

function renderTicket(props: Partial<ComponentProps<typeof ReceiptTicket>> = {}) {
  return render(
    <I18nProvider locale="en">
      <ReceiptTicket {...BASE} {...props} />
    </I18nProvider>,
  );
}

const celebrating = () => document.querySelector('[data-celebrate]');

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe('receipt ticket', () => {
  it('plays the Verified Paid seal once per receipt, then shows it static', () => {
    renderTicket({ celebrateKey: 'req:cb1' });
    expect(screen.getByRole('heading', { name: 'Verified Paid' })).toBeTruthy();
    expect(celebrating()).not.toBeNull();
    cleanup();
    renderTicket({ celebrateKey: 'req:cb1' });
    expect(screen.getByRole('heading', { name: 'Verified Paid' })).toBeTruthy();
    expect(celebrating()).toBeNull();
    cleanup();
    // A different verified receipt gets its own moment.
    renderTicket({ celebrateKey: 'req:cb2' });
    expect(celebrating()).not.toBeNull();
  });

  it('never animates a receipt that is only paid per contract', () => {
    renderTicket({ status: 'contract_paid', celebrateKey: 'req:cb3' });
    expect(screen.queryByRole('heading', { name: 'Verified Paid' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Payment recorded' })).toBeTruthy();
    expect(celebrating()).toBeNull();
    expect(document.querySelector('svg[width="28"] path')?.getAttribute('d')).toBe('M12 8v4.5l3 1.5');
    expect(screen.getByText('Independent receipt check pending').closest('details')).toBeNull();
  });

  it('keeps hashes and the checking provider under a collapsed Technical proof', () => {
    renderTicket();
    const proof = screen.getByText('Technical proof').closest('details');
    expect(proof).not.toBeNull();
    expect(proof?.open).toBe(false);
    expect(proof?.textContent).toContain('CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su');
    expect(proof?.textContent).toContain('fastnear-testnet');
  });
});
