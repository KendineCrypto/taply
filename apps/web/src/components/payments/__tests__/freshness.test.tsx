import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateRequest } from '../CreateRequest';
import { PaymentScreen } from '../PaymentScreen';
import { FIXTURES, OTHER_CODE_HASH, chainClock, configFor, installChain, must, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { MAX_CHAIN_AGE_MS, MAX_CHAIN_FUTURE_MS, chainFreshness } from '@/lib/payments/freshness';
import { CHECK_REUSE_MS } from '@/lib/payments/context';

/**
 * Phase 5C: stale finalized-chain observations are rejected before new terms
 * are built or a payment is authorized. Reviewed terms are never edited; the
 * person must review again. Nothing here signs when data is stale.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const CONTRACT = 'payments.taply-review.testnet';
const CREATOR = 'merchant.testnet';
const CHAIN_MS = 1_793_476_890_000;
const nsOf = (ms: number) => (BigInt(ms) * 1_000_000n).toString();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => push.mockReset());

describe('chainFreshness', () => {
  it('accepts recent blocks and rejects old or future ones', () => {
    const now = CHAIN_MS;
    expect(chainFreshness(nsOf(now), now)).toBe('fresh');
    expect(chainFreshness(nsOf(now - MAX_CHAIN_AGE_MS), now)).toBe('fresh');
    expect(chainFreshness(nsOf(now - MAX_CHAIN_AGE_MS - 1), now)).toBe('stale');
    expect(chainFreshness(nsOf(now + MAX_CHAIN_FUTURE_MS), now)).toBe('fresh');
    expect(chainFreshness(nsOf(now + MAX_CHAIN_FUTURE_MS + 1), now)).toBe('future');
    expect(chainFreshness('not-a-number', now)).toBe('stale');
  });
});

async function toReview(amount: string) {
  fireEvent.change(await screen.findByLabelText('Amount (NEAR)'), { target: { value: amount } });
  const next = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
  await waitFor(() => expect(next.disabled).toBe(false));
  await act(async () => {
    fireEvent.click(next);
  });
  await screen.findByRole('heading', { name: 'Check before you sign' });
}

describe('request creation refuses stale chain data', () => {
  it('a stalled provider (old final block) disables creation and no quote is requested', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: nsOf(CHAIN_MS) });
    const { adapter, signed } = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter, now: () => CHAIN_MS + 5 * 60_000 });
    expect(await screen.findByText('Network data is out of date')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(chain.calls.some((c) => c.methodName === 'quote_create_request')).toBe(false);
    expect(signed).toHaveLength(0);
  });

  it('a final block ahead of the device clock pauses signing and says why', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: nsOf(CHAIN_MS) });
    const { adapter } = recordingWallet(CREATOR);
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter, now: () => CHAIN_MS - 60_000 });
    expect(await screen.findByText('Your device clock looks out of sync')).toBeTruthy();
  });

  it('if the chain stalls after review, signing is refused and the reviewed terms are dropped for a new review', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: nsOf(CHAIN_MS) });
    const { adapter, signed } = recordingWallet(CREATOR);
    let now = CHAIN_MS;
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter, now: () => now });
    await toReview('1');
    // Two minutes pass on the device; the provider is stuck on the same final block.
    now += 2 * 60_000;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' }));
    });
    expect(signed).toHaveLength(0);
    expect(await screen.findByText('Please review again')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Check before you sign' })).toBeNull();
  });

  it('a contract configuration change between review and signing requires a new review', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: nsOf(CHAIN_MS) });
    const { adapter, signed } = recordingWallet(CREATOR);
    let now = CHAIN_MS;
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter, now: () => now });
    await toReview('1');
    // Time moves on (chain and device together) and the verified config changes.
    now += CHECK_REUSE_MS + 5_000;
    chain.blockTimestampNs = nsOf(now);
    chain.config = configFor(CONTRACT, { storageByteCostYocto: '20000000000000000000' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' }));
    });
    expect(signed).toHaveLength(0);
    expect(await screen.findByText('Please review again')).toBeTruthy();
  });

  it('an aged check is re-read at a fresh block before terms are built (expiry anchored to the new block)', async () => {
    const chain = installChain({ contractId: CONTRACT, blockTimestampNs: nsOf(CHAIN_MS) });
    const { adapter, signed } = recordingWallet(CREATOR);
    let now = CHAIN_MS;
    renderWithChain(<CreateRequest />, { setup: readySetup(chain, true), adapter, now: () => now });
    await screen.findByLabelText('Amount (NEAR)');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false));
    // The tab sat open for ten minutes; the chain moved on normally.
    now += 10 * 60_000;
    chain.blockTimestampNs = nsOf(now);
    const configReads = () => chain.calls.filter((c) => c.methodName === 'get_config').length;
    const before = configReads();
    await toReview('1');
    expect(configReads()).toBeGreaterThan(before);
    const quoted = must(chain.calls.find((c) => c.methodName === 'quote_create_request'), 'a quote').args as {
      terms: { fundingExpiresAtNs: string };
    };
    expect(quoted.terms.fundingExpiresAtNs).toBe((BigInt(nsOf(now)) + 900_000_000_000n).toString());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create request in wallet' }));
    });
    expect(signed).toHaveLength(1);
  });
});

describe('payment authorization refuses stale chain data', () => {
  const { openRestricted } = FIXTURES;
  const PAYER = must(openRestricted.terms.permittedPayerAccountId, 'a payer');

  it('an old request read is re-read and the payer must review again; the wallet is not asked', async () => {
    const start = CHAIN_MS;
    const chain = installChain({ contractId: openRestricted.terms.contractId, blockTimestampNs: nsOf(start) });
    chain.requests.set(openRestricted.terms.id, openRestricted);
    const { adapter, signed } = recordingWallet(PAYER);
    let now = start;
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter, now: () => now });
    const review = must((await screen.findByRole('heading', { name: 'Review payment' })).closest('section'), 'review');
    fireEvent.click(within(review).getByLabelText('I checked the recipient account and the amount.'));
    // The screen sat open: the request read is now two minutes old.
    now += 2 * 60_000;
    await act(async () => {
      fireEvent.click(within(review).getByRole('button', { name: 'Approve in wallet' }));
    });
    expect(signed).toHaveLength(0);
    expect(await screen.findByText('Please review again')).toBeTruthy();
    // The confirmation starts over.
    const fresh = must((await screen.findByRole('heading', { name: 'Review payment' })).closest('section'), 'review');
    expect((within(fresh).getByLabelText('I checked the recipient account and the amount.') as HTMLInputElement).checked).toBe(false);
  });

  it('with fresh data the same flow still asks the wallet exactly once', async () => {
    const chain = installChain({ contractId: openRestricted.terms.contractId, blockTimestampNs: nsOf(CHAIN_MS) });
    chain.requests.set(openRestricted.terms.id, openRestricted);
    const { adapter, signed } = recordingWallet(PAYER);
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter });
    const review = must((await screen.findByRole('heading', { name: 'Review payment' })).closest('section'), 'review');
    fireEvent.click(within(review).getByLabelText('I checked the recipient account and the amount.'));
    await act(async () => {
      fireEvent.click(within(review).getByRole('button', { name: 'Approve in wallet' }));
    });
    await waitFor(() => expect(signed).toHaveLength(1));
    expect(screen.queryByText('Please review again')).toBeNull();
  });
});

describe('Phase 7H: one retry control for one outage on the pay screen', () => {
  const { openRestricted } = FIXTURES;
  const PAYER = must(openRestricted.terms.permittedPayerAccountId, 'a payer');

  it('a stale contract check shows no second "Try again"; the single "Check again" re-runs the check and the read', async () => {
    const chain = installChain({ contractId: openRestricted.terms.contractId, blockTimestampNs: nsOf(CHAIN_MS) });
    chain.requests.set(openRestricted.terms.id, openRestricted);
    const { adapter, signed } = recordingWallet(PAYER);
    const now = CHAIN_MS + 5 * 60_000;
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter, now: () => now });
    expect(await screen.findByText('Network data is out of date')).toBeTruthy();
    const checkAgain = await waitFor(() => {
      const found = screen.getAllByRole('button', { name: /Check again/ });
      expect(found).toHaveLength(1);
      return found;
    });
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    const configReads = () => chain.calls.filter((c) => c.methodName === 'get_config').length;
    const requestReads = () => chain.calls.filter((c) => c.methodName === 'get_request').length;
    const [configBefore, requestBefore] = [configReads(), requestReads()];
    // The provider catches up; one tap clears the outage.
    chain.blockTimestampNs = nsOf(now);
    await act(async () => {
      fireEvent.click(must(checkAgain[0], 'check again'));
    });
    await waitFor(() => expect(screen.queryByText('Network data is out of date')).toBeNull());
    expect(configReads()).toBeGreaterThan(configBefore);
    expect(requestReads()).toBeGreaterThan(requestBefore);
    expect(signed).toHaveLength(0);
  });

  it('a code-hash mismatch stays a danger notice with no retry, and "Check again" never clears it', async () => {
    const chain = installChain({ contractId: openRestricted.terms.contractId, codeHash: OTHER_CODE_HASH });
    chain.requests.set(openRestricted.terms.id, openRestricted);
    const { adapter, signed } = recordingWallet(PAYER);
    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, { setup: readySetup(chain, true), adapter, now: chainClock(chain) });
    const notice = await screen.findByText('Contract code does not match');
    const checkAgain = await waitFor(() => must(screen.getAllByRole('button', { name: /Check again/ })[0], 'check again'));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await act(async () => {
      fireEvent.click(checkAgain);
    });
    expect(notice.isConnected || screen.queryByText('Contract code does not match') !== null).toBe(true);
    expect(screen.queryByRole('button', { name: 'Approve in wallet' })).toBeNull();
    expect(signed).toHaveLength(0);
  });
});
