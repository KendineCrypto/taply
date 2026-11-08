import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplitScreen } from '../SplitScreen';
import { RecurringScreen } from '@/components/recurring/RecurringScreen';
import { CreateRequest } from '@/components/payments/CreateRequest';
import { installChain, memoryStorage, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { JOURNAL_STORAGE_KEY } from '@/lib/payments/journal';
import { ContractRequestSchema } from '@/lib/protocol';
import pilotJson from '@/test/fixtures/testnet/pilot-request.json';
import { RECURRING_STORAGE_KEY, civilToday, createTemplate, deviceTimeZone, loadTemplates } from '@/lib/recurring/recurring';
import { SPLIT_STORAGE_KEY, createSplit, loadSplits } from '@/lib/split/split';
import { buildPrefillLink } from '@/lib/tools/handoff';
import { buildPaidChain } from '@/lib/verify/__tests__/fake-chain';

/**
 * E2/E3 UI. Every chain answer here is synthetic except the recorded pilot
 * get_request fixture; the "wallet" is the test recorder (nothing reaches a
 * network or a real wallet). None of this is Testnet evidence.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const ME = 'taplytest.testnet';
const APPROVED = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';
const PILOT = ContractRequestSchema.parse(pilotJson);

beforeEach(() => {
  window.localStorage.clear();
  push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

async function change(label: string | RegExp, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

describe('/recurring', () => {
  it('asks to connect first, and never offers a background or automatic action', async () => {
    const chain = installChain({ contractId: 'pay.testnet' });
    renderWithChain(<RecurringScreen />, { setup: readySetup(chain, false), adapter: recordingWallet(null).adapter });
    expect(await screen.findByText(/Connect your NEAR Testnet wallet to create templates/)).toBeTruthy();
    expect(screen.getByTestId('not-subscription').textContent).toContain('No auto-pay');
  });

  it('creates a template, shows the due date and next dates, and links to a PRE-FILLED request form', async () => {
    const chain = installChain({ contractId: 'pay.testnet' });
    renderWithChain(<RecurringScreen />, { setup: readySetup(chain, false), adapter: recordingWallet(ME).adapter });
    fireEvent.click(await screen.findByRole('button', { name: /New template/ }));
    await change('Name', 'Rent');
    await change('Amount (NEAR)', '1.5');
    await change('Only this account may pay (optional)', 'tenant.testnet');
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    const card = await screen.findByTestId('template-card');
    expect(card.getAttribute('data-occurrence')).toBe('due');
    expect(within(card).getAllByRole('listitem').length).toBeGreaterThan(0);
    const today = civilToday(deviceTimeZone(), new Date());
    const link = within(card).getByRole('link', { name: /Prepare request for/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/request/new?amountYocto=1500000000000000000000000');
    expect(href).toContain('payer=tenant.testnet');
    expect(href).toContain(`%3A${today}`);

    fireEvent.click(within(card).getByRole('button', { name: 'Stop: Rent' }));
    await waitFor(() => expect(screen.getByTestId('template-card').getAttribute('data-status')).toBe('cancelled'));
    expect(screen.queryByRole('link', { name: /Prepare request for/ })).toBeNull();
  });

  it('the request form uses the pre-fill, and after the wallet step links the occurrence so it is not offered twice', async () => {
    const created = createTemplate(
      { name: 'Rent', amount: '1.5', memo: 'Flat 3', payer: '', cadence: 'monthly', startDate: civilToday('UTC', new Date()), endDate: '' },
      { recipientAccountId: ME, timeZone: 'UTC', now: new Date(), id: 'template-0001' },
    );
    if (!created.ok) throw new Error('template');
    window.localStorage.setItem(RECURRING_STORAGE_KEY, JSON.stringify({ version: 1, templates: [created.template] }));
    const date = civilToday('UTC', new Date());
    const link = buildPrefillLink({ amountBaseUnits: created.template.amountBaseUnits, memo: 'Flat 3', payer: null, source: { kind: 'recurring', id: 'template-0001', key: date } });
    window.history.replaceState(null, '', link);

    const chain = installChain({ contractId: 'payments.taply-review.testnet', blockTimestampNs: '1793476890000000000' });
    const { adapter, signed } = recordingWallet(ME);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter, storage: memoryStorage() });
    expect((await screen.findByLabelText('Amount (NEAR)') as HTMLInputElement).value).toBe('1.5');
    expect(screen.getByTestId('prefill-banner').textContent).toContain('Rent');
    expect(signed).toEqual([]); // nothing happens until the person continues

    const review = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    await waitFor(() => expect(review.disabled).toBe(false));
    await act(async () => fireEvent.click(review));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Create request in wallet' })));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(signed).toHaveLength(1);

    const stored = loadTemplates(window.localStorage);
    expect(stored.status === 'ok' && stored.templates[0]?.occurrences.map((o) => o.date)).toEqual([date]);
  });
});

describe('/split', () => {
  it('creates an exact equal split and offers one pre-filled request per person; signing-off is said plainly', async () => {
    const chain = installChain({ contractId: 'pay.testnet' });
    renderWithChain(<SplitScreen />, { setup: readySetup(chain, false), adapter: recordingWallet(ME).adapter });
    fireEvent.click(await screen.findByRole('button', { name: /New split/ }));
    await change('What is it for?', 'Dinner');
    await change('Total (NEAR)', '1');
    await change('Name 1', 'Ali');
    await change('Name 2', 'Can');
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await change('Name 3', 'Deniz');
    await change('Their NEAR Testnet account (optional) 3', 'deniz.testnet');
    // Rounded on screen; the exact base-unit values stay available (data-exact + "Exact amounts").
    expect(screen.getAllByTestId('split-equal-share').map((e) => e.textContent)).toEqual(['≈ 0.33333 NEAR', '≈ 0.33333 NEAR', '≈ 0.33333 NEAR']);
    expect(screen.getByTestId('split-exact')).toBeTruthy();
    expect(screen.getAllByTestId('split-equal-share').map((e) => e.getAttribute('data-exact'))).toEqual([
      '0.333333333333333333333334 NEAR',
      '0.333333333333333333333333 NEAR',
      '0.333333333333333333333333 NEAR',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Save split' }));
    const group = await screen.findByTestId('split-group');
    expect(group.getAttribute('data-group-status')).toBe('preparing');
    expect(within(group).getByTestId('split-signing-off')).toBeTruthy();
    const links = within(group).getAllByRole('link', { name: 'Prepare request' }).map((a) => a.getAttribute('href') ?? '');
    expect(links).toHaveLength(3);
    expect(links[0]).toContain('amountYocto=333333333333333333333334');
    expect(links[2]).toContain('payer=deniz.testnet');
  });

  it('custom shares must add up exactly before saving', async () => {
    const chain = installChain({ contractId: 'pay.testnet' });
    renderWithChain(<SplitScreen />, { setup: readySetup(chain, false), adapter: recordingWallet(ME).adapter });
    fireEvent.click(await screen.findByRole('button', { name: /New split/ }));
    await change('What is it for?', 'Trip');
    await change('Total (NEAR)', '2');
    fireEvent.click(screen.getByLabelText('Custom amounts'));
    await change('Name 1', 'Ali');
    await change('Name 2', 'Can');
    await change('Share (NEAR) 1', '1.2');
    await change('Share (NEAR) 2', '0.7');
    expect(screen.getByTestId('split-sum').textContent).toContain('+0.1');
    fireEvent.click(screen.getByRole('button', { name: 'Save split' }));
    expect(within(screen.getByTestId('split-problems')).getByText('The shares must add up to the total exactly.')).toBeTruthy();
    expect(loadSplits(window.localStorage)).toEqual({ status: 'ok', groups: [] });
  });

  it('a paid share is "Payment recorded" until the verifier confirms it; the group never reads final early', async () => {
    const created = createSplit(
      { name: 'Pilot', total: '0.2', mode: 'equal', memo: '', people: [{ label: 'One', account: '', share: '' }, { label: 'Two', account: '', share: '' }] },
      { recipientAccountId: ME, now: new Date(), id: 'group-00001', participantId: (i) => `person-000${i}` },
    );
    if (!created.ok) throw new Error('split');
    const g = { ...created.group, participants: created.group.participants.map((p, i) => (i === 0 ? { ...p, requestId: PILOT.terms.id, recordedAt: new Date().toISOString() } : p)) };
    window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify({ version: 1, groups: [g] }));

    // The fake chain's clock must be after the real pilot's funding time, or the read is (rightly) inconsistent.
    const chain = installChain({ contractId: PILOT.terms.contractId, codeHash: APPROVED, blockTimestampNs: '1793600000000000000' });
    chain.requests.set(PILOT.terms.id, PILOT);
    const verifier = buildPaidChain(PILOT);
    verifier.chain.defaultCodeHash = APPROVED;
    const storage = memoryStorage();
    storage.setItem(
      JOURNAL_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          {
            method: 'pay_instant_native', network: 'near-testnet', contractId: PILOT.terms.contractId, requestId: PILOT.terms.id, termsHash: PILOT.termsHash,
            signerAccountId: PILOT.payerAccountId, terms: null, operationNonce: null, phase: 'RESOLVED', transactionHash: verifier.input.fundingTransaction.hash,
            startedAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
          },
        ],
      }),
    );
    renderWithChain(<SplitScreen />, { setup: readySetup(chain, false, APPROVED, verifier.input.rpc), adapter: recordingWallet(ME).adapter, storage });
    const children = await screen.findAllByTestId('split-child');
    await waitFor(() => expect(children[0]?.getAttribute('data-child-status')).toBe('paid_per_contract'));
    expect(screen.getByTestId('split-group').getAttribute('data-group-status')).toBe('preparing');
    fireEvent.click(within(children[0] as HTMLElement).getByRole('button', { name: 'Verify receipt' }));
    await waitFor(() => expect(screen.getAllByTestId('split-child')[0]?.getAttribute('data-child-status')).toBe('verified'), { timeout: 5000 });
    // One share verified, one not created: still not final.
    expect(screen.getByTestId('split-group').getAttribute('data-group-status')).not.toBe('settled_verified');
    expect(screen.getByTestId('split-verified-sum').textContent).toContain('0.1 NEAR');
  });
});
