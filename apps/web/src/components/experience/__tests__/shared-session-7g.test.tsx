import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SharedSession } from '../SharedSession';
import { I18nProvider } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n';
import type { ProgressStage } from '../progress';

/**
 * Phase 7G: the merchant's and the customer's phones present the same
 * canonical facts (amount, receiving account, sale code, stage) and one status
 * each. Presentation only; stages are decided upstream from chain evidence.
 */

const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const BASE: ComponentProps<typeof SharedSession> = {
  side: 'receiver',
  context: 'pos',
  stage: 'awaiting',
  requestId: ID,
  amountBaseUnits: '123456789012345678901234567',
  recipientAccountId: 'a-very-long-merchant-account-name-for-the-counter.testnet',
  payerAccountId: 'customer.testnet',
  showAmount: true,
  live: false,
};

function view(props: Partial<ComponentProps<typeof SharedSession>>, locale: Locale = 'en') {
  return (
    <I18nProvider locale={locale}>
      <SharedSession {...BASE} {...props} />
    </I18nProvider>
  );
}

/** The facts both phones must agree on, read from the rendered hero. */
function facts() {
  const hero = document.querySelector('.journey-hero') as HTMLElement;
  return {
    code: hero.querySelector('[data-testid="sale-code"] [aria-label]')?.getAttribute('aria-label'),
    account: hero.querySelector('.chain-id')?.textContent,
    amount: hero.querySelector('.display-amount')?.textContent,
    stage: hero.getAttribute('data-stage'),
    status: hero.querySelector('[data-testid="journey-status"]')?.getAttribute('data-status'),
  };
}

afterEach(cleanup);

const PAIRS: ReadonlyArray<[ProgressStage, string, string]> = [
  ['awaiting', 'ready_for_customer', 'ready_to_review'],
  ['transfer', 'payment_observed', 'transaction_submitted'],
  ['contract_paid', 'paid_per_contract', 'paid_per_contract'],
  ['verified', 'verified_receipt', 'verified_paid'],
];

describe('two-phone consistency', () => {
  it.each(PAIRS)('%s: both phones show the same amount, account, code and stage; status differs only by side', (stage, merchant, customer) => {
    render(view({ stage, side: 'receiver' }));
    const m = facts();
    cleanup();
    render(view({ stage, side: 'payer', context: 'checkout' }));
    const c = facts();
    expect(m.code).toBe(c.code);
    expect(m.account).toBe(c.account);
    expect(m.amount).toMatch(/\d/);
    expect(m.amount).toBe(c.amount);
    expect(m.code).toMatch(/^Sale code: /);
    expect(m.stage).toBe(c.stage);
    expect(m.status).toBe(merchant);
    expect(c.status).toBe(customer);
  });

  it('the long amount and account are shown in full, never truncated', () => {
    render(view({}));
    const hero = document.querySelector('.journey-hero') as HTMLElement;
    expect(hero.textContent).toContain(BASE.recipientAccountId);
    expect(hero.textContent?.replace(/[^\d]/g, '')).toContain('123456789012345678901234567'.replace(/0+$/, '').slice(0, 9));
  });
});

describe('status chip honesty', () => {
  it('a verified status passed with a non-verified stage is replaced by the stage’s own status', () => {
    for (const stage of ['awaiting', 'transfer', 'contract_paid', 'failed'] as const) {
      render(view({ stage, side: 'payer', status: 'verified_paid' }));
      expect(screen.getByTestId('journey-status').getAttribute('data-status')).not.toBe('verified_paid');
      cleanup();
    }
  });

  it('a payer whose own attempt is unexplained reads Checking chain, not Ready to review', () => {
    render(view({ stage: 'awaiting', side: 'payer', status: 'checking_chain' }));
    expect(screen.getByTestId('journey-status').textContent).toContain('Checking chain');
  });

  it('only verified statuses use the lime treatment', () => {
    for (const [stage] of PAIRS) {
      render(view({ stage }));
      const chip = screen.getByTestId('journey-status');
      expect(chip.className.includes('bg-[var(--taply-lime)]')).toBe(stage === 'verified');
      cleanup();
    }
  });

  it('a duplicate identical update keeps the same chip node (no replayed transition); a real change replaces it', () => {
    const { rerender } = render(view({ stage: 'awaiting' }));
    const first = screen.getByTestId('journey-status');
    rerender(view({ stage: 'awaiting' }));
    expect(screen.getByTestId('journey-status')).toBe(first);
    rerender(view({ stage: 'transfer' }));
    expect(screen.getByTestId('journey-status')).not.toBe(first);
    expect(screen.getByTestId('journey-status').getAttribute('data-status')).toBe('payment_observed');
  });

  it('Turkish labels', () => {
    render(view({ stage: 'contract_paid', side: 'payer' }, 'tr'));
    expect(screen.getByTestId('journey-status').textContent).toContain('Kontrata göre ödendi');
  });

  it('Paid per contract offers exactly one next step, and the merchant is told it checks receipts itself', () => {
    render(view({ stage: 'contract_paid', proofAction: <button type="button">Verify receipt</button> }));
    expect(screen.getAllByRole("button", { name: "Verify receipt" })).toHaveLength(1);
    expect(screen.getByText(/looks the payment up on chain/)).toBeTruthy();
    expect(screen.getByText('Verified Paid: Not checked on this screen')).toBeTruthy();
  });

  it('no live hero claims presence or joining (Handshake is not live)', () => {
    for (const stage of ['awaiting', 'wallet', 'transfer', 'contract_paid', 'verified'] as const) {
      for (const side of ['receiver', 'payer'] as const) {
        render(view({ stage, side, live: side === 'receiver' }));
        const text = (document.querySelector('.journey-hero')?.textContent ?? '').toLowerCase();
        expect(text).not.toMatch(/joined|connected|online|customer is (here|looking)/);
        cleanup();
      }
    }
  });
});


describe('Phase 7I progressive disclosure', () => {
  it.each(['en', 'tr'] as const)('%s: keeps action and unverified warning outside collapsed details', (locale) => {
    render(view({ stage: 'contract_paid', proofAction: <button>Verify</button> }, locale));
    const details = screen.getByTestId('journey-details');
    expect(details.hasAttribute('open')).toBe(false);
    expect(screen.getByRole('button', { name: 'Verify' }).closest('details')).toBeNull();
    expect(document.querySelector('#journey-title')?.closest('details')).toBeNull();
    expect(document.querySelector('#journey-title')?.parentElement?.textContent).toContain(
      locale === 'en' ? 'not independently verified yet' : 'henüz bağımsız doğrulanmadı',
    );
    expect(details.querySelector('summary')?.className).toContain('min-h-[44px]');
    expect(details.querySelector('ol')).not.toBeNull();
  });

  it('keeps the no-repeat-payment warning outside Details', () => {
    render(view({ stage: 'transfer', side: 'payer' }));
    expect(screen.getByText('Not final yet. Do not pay again.').closest('details')).toBeNull();
  });
});
