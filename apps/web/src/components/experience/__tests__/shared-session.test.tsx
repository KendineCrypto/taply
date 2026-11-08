import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PaymentProgress } from '../PaymentProgress';
import { SharedSession } from '../SharedSession';
import { ReceiptTicket } from '../ReceiptTicket';
import { HandshakeDemo } from '@/components/handshake/HandshakeDemo';
import { I18nProvider } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import type { ProgressStage } from '../progress';

/** Presentation only: the caller decides the stage from chain state and the verifier. */

const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const BASE: ComponentProps<typeof SharedSession> = {
  side: 'receiver',
  context: 'pos',
  stage: 'awaiting',
  requestId: ID,
  amountBaseUnits: '2500000000000000000000000',
  recipientAccountId: 'shop.testnet',
  payerAccountId: null,
  showAmount: true,
  live: false,
};

function renderSession(props: Partial<ComponentProps<typeof SharedSession>> = {}, locale: Locale = 'en') {
  return render(
    <I18nProvider locale={locale}>
      <SharedSession {...BASE} {...props} />
    </I18nProvider>,
  );
}

const heroOf = () => screen.getByRole('heading', { level: 2 }).closest('section') as HTMLElement;
const nodeStates = () => [...document.querySelectorAll('li[data-state]')].map((li) => li.getAttribute('data-state'));

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe('shared session hero', () => {
  it.each<[ProgressStage, 'receiver' | 'payer', string]>([
    ['awaiting', 'receiver', 'Ready for the customer'],
    ['transfer', 'receiver', 'Payment seen on chain'],
    ['contract_paid', 'receiver', 'Payment recorded'],
    ['verified', 'receiver', 'Independently verified'],
    ['wallet', 'payer', 'Waiting for your wallet'],
    ['transfer', 'payer', 'Payment submitted'],
    ['contract_paid', 'payer', 'Payment recorded'],
    ['failed', 'payer', 'Transfer failed — recoverable'],
  ])('%s on the %s side reads "%s"', (stage, side, title) => {
    renderSession({ stage, side });
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeTruthy();
  });

  it('uses the lime success tone and a complete track ONLY when verified', () => {
    for (const stage of ['awaiting', 'wallet', 'transfer', 'contract_paid', 'failed', 'unresolved', 'cancelled'] as const) {
      renderSession({ stage });
      expect(heroOf().getAttribute('data-tone')).not.toBe('success');
      expect(nodeStates().at(-1)).not.toBe('done');
      cleanup();
    }
    renderSession({ stage: 'verified' });
    expect(heroOf().getAttribute('data-tone')).toBe('success');
    expect(nodeStates()).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('Payment recorded shows the receipt check as NOT done, side by side', () => {
    renderSession({ stage: 'contract_paid', payerAccountId: 'buyer.testnet' });
    const legend = screen.getByTestId('proof-legend');
    expect(within(legend).getByText('Contract record: paid')).toBeTruthy();
    // Phase 7H: the legend no longer repeats the status chip and hero title verbatim.
    expect(within(legend).queryByText('Payment recorded')).toBeNull();
    expect(within(legend).getByText('Verified Paid: Not checked on this screen')).toBeTruthy();
    expect(nodeStates()).toEqual(['done', 'done', 'done', 'done', 'todo']);
    expect(screen.getByText('Paid by buyer.testnet')).toBeTruthy();
  });

  it('timeline steps keep full names and states for screen readers', () => {
    renderSession({ stage: 'transfer' });
    expect(screen.getByText('Transfer sent: in progress')).toBeTruthy();
    expect(screen.getByText('Independently verified: not yet')).toBeTruthy();
  });

  it('spells the sale code out for screen readers and hides it when the ticket below carries it', () => {
    renderSession();
    const label = screen.getByTestId('sale-code').querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/^Sale code: ([0-9A-Z] ){5}[0-9A-Z]$/);
    cleanup();
    renderSession({ showAmount: false });
    expect(screen.queryByTestId('sale-code')).toBeNull();
    cleanup();
    renderSession({ showAmount: false, side: 'payer', context: 'checkout' });
    expect(screen.getByTestId('sale-code')).toBeTruthy();
  });

  it('marks a live screen and explains it to assistive tech', () => {
    renderSession({ live: true });
    expect(heroOf().getAttribute('data-live')).toBe('true');
    expect(screen.getByText(/Watching the chain/)).toBeTruthy();
  });

  it('Turkish copy', () => {
    renderSession({ side: 'payer', context: 'checkout' }, 'tr');
    expect(screen.getByText('Ödeme')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Ödemeye hazır' })).toBeTruthy();
    expect(screen.getByText('Satış kodu')).toBeTruthy();
  });
});

describe('Verified Paid celebration', () => {
  const ticket = (status: 'verified' | 'contract_paid', key: string) =>
    render(
      <I18nProvider locale="en">
        <ReceiptTicket
          status={status}
          amountBaseUnits="1"
          recipientAccountId="shop.testnet"
          payerAccountId="buyer.testnet"
          memo=""
          settledAtNs="1793476890000000000"
          references={[]}
          explorerBaseUrl={null}
          celebrateKey={key}
          code="4K7Q2M"
        />
      </I18nProvider>,
    );

  it('bursts once for a verified receipt, never for Payment recorded, and prints the sale code', () => {
    ticket('verified', 'r:1');
    expect(document.querySelectorAll('.celebrate-burst, .celebrate-burst-late')).toHaveLength(2);
    expect(screen.getByText('4K7 Q2M')).toBeTruthy();
    cleanup();
    ticket('verified', 'r:1');
    expect(document.querySelectorAll('.celebrate-burst')).toHaveLength(0);
    cleanup();
    ticket('contract_paid', 'r:2');
    expect(document.querySelectorAll('.celebrate-burst')).toHaveLength(0);
  });
});

describe('Handshake demo coordination (DEMO only)', () => {
  it('both phones move together: waiting, joined, reviewing, waiting for wallet', () => {
    render(
      <I18nProvider locale="en">
        <HandshakeDemo />
      </I18nProvider>,
    );
    const status = () => screen.getAllByTestId('demo-status').map((s) => s.textContent);
    const next = () => fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(status()).toEqual(['Waiting for the customer']);
    next();
    expect(status()).toEqual(['Customer joined', 'Merchant is ready']);
    next();
    expect(status()).toEqual(['Customer joined', 'Reviewing payment']);
    next();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm review' }));
    next();
    expect(status()).toEqual(['Waiting for wallet approval', 'Waiting for your wallet']);
    // Still stamped DEMO, and no paid state anywhere.
    expect(screen.getByText('Synthetic data · no network · no wallet')).toBeTruthy();
    expect(screen.queryByText(/Verified Paid|Payment recorded/)).toBeNull();
  });
});


describe('non-final payment icon', () => {
  it.each(['en', 'tr'] as const)('%s: contract-paid heroes use a clock, never a success check', (locale) => {
    for (const component of [<SharedSession {...BASE} stage="contract_paid" />, <PaymentProgress stage="contract_paid" />]) {
      const { container } = render(<I18nProvider locale={locale}>{component}</I18nProvider>);
      const icon = container.querySelector('svg[width="24"]');
      expect(icon?.querySelector('circle')).not.toBeNull();
      expect(icon?.querySelector('path')?.getAttribute('d')).toBe('M12 8v4.5l3 1.5');
      expect(container.querySelector('.animate-draw')).toBeNull();
      cleanup();
    }
  });
});
