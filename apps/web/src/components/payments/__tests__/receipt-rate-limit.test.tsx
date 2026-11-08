import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptScreen } from '../ReceiptScreen';
import { installChain, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { ContractRequestSchema, calculateTermsHash } from '@/lib/protocol';
import pilotJson from '@/test/fixtures/testnet/pilot-request.json';
import { VerifierRpcError } from '@/lib/verify/rpc';
import type { VerifierRpc } from '@/lib/verify/rpc';
import { buildPaidChain } from '@/lib/verify/__tests__/fake-chain';

/**
 * /receipt under RPC rate limits, with the REAL pilot contract state
 * (src/test/fixtures/testnet/pilot-request.json, a recorded view result).
 * Every rate limit and every verifier answer here is SYNTHETIC.
 */

const PILOT = ContractRequestSchema.parse(pilotJson);
const APPROVED = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';
const FUNDING = 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const rateLimited = (retryAfterMs: number): VerifierRpc => ({
  providerId: 'synthetic-busy',
  call: async () => {
    throw new VerifierRpcError('RATE_LIMITED', retryAfterMs);
  },
});

function render(request = PILOT, verifierRpc: VerifierRpc | null = rateLimited(418_000)) {
  const chain = installChain({ contractId: request.terms.contractId, codeHash: APPROVED });
  chain.requests.set(request.terms.id, request);
  window.history.replaceState(null, '', `/receipt/${request.terms.id}?ftx=${FUNDING}`);
  const setup = readySetup(chain, false, APPROVED, verifierRpc);
  renderWithChain(<ReceiptScreen id={request.terms.id} />, { setup, adapter: recordingWallet(null).adapter });
  return { chain, setup };
}

describe('receipt under RPC rate limits', () => {
  it('says the RPC is busy, never auto-retries a long wait, and shows the archive as archive only', async () => {
    render();
    const failed = await screen.findByTestId('verification-failed', {}, { timeout: 5000 });
    expect(failed.getAttribute('data-reason')).toBe('RATE_LIMITED');
    expect(screen.getByText('RPC busy: verification paused')).toBeTruthy();
    expect(screen.getByTestId('verification-wait-until')).toBeTruthy();
    expect(screen.queryByTestId('verification-auto-retry')).toBeNull();

    // Today's status stays Payment recorded: no ribbon, no verified receipt.
    expect(screen.queryByTestId('verified-evidence')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Verified Paid' })).toBeNull();
    expect(document.querySelector('[data-receipt-status="verified"]')).toBeNull();
    expect(document.querySelector('[data-receipt-status="contract_paid"]')).not.toBeNull();

    const archived = screen.getByTestId('archived-verification');
    expect(archived.getAttribute('data-archived')).toBe('true');
    expect(archived.textContent).toContain('Archived record · not a live check');
    expect(archived.textContent).toContain('not a new chain read');
    expect(archived.textContent).toContain('2026-11-01T15:36:30.100Z');
    expect(archived.querySelector('[data-receipt-status]')).toBeNull();
    expect(archived.querySelector('a')?.getAttribute('href')).toBe('/evidence/instant-pay-2026-11-01-receipt.json');
  });

  it('schedules one bounded automatic re-check for a short provider wait', async () => {
    render(PILOT, rateLimited(20_000));
    expect(await screen.findByTestId('verification-auto-retry', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('shows no archive when the contract reports other terms for this ID', async () => {
    // Same request ID (ID does not cover the memo), different immutable terms.
    const terms = { ...PILOT.terms, memo: 'different terms' };
    const altered = ContractRequestSchema.parse({ ...pilotJson, terms, termsHash: calculateTermsHash(terms) });
    expect(altered.terms.id).toBe(PILOT.terms.id);
    render(altered);
    await screen.findByTestId('verification-failed', {}, { timeout: 5000 });
    expect(screen.queryByTestId('archived-verification')).toBeNull();
  });

  it('a fresh successful verification shows Verified Paid and no archive', async () => {
    const fresh = buildPaidChain(PILOT);
    fresh.chain.defaultCodeHash = APPROVED;
    const chain = installChain({ contractId: PILOT.terms.contractId, codeHash: APPROVED });
    chain.requests.set(PILOT.terms.id, PILOT);
    window.history.replaceState(null, '', `/receipt/${PILOT.terms.id}?ftx=${fresh.input.fundingTransaction.hash}`);
    const setup = readySetup(chain, false, APPROVED, fresh.input.rpc);
    renderWithChain(<ReceiptScreen id={PILOT.terms.id} />, { setup, adapter: recordingWallet(null).adapter });
    expect(await screen.findByTestId('verified-evidence', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('archived-verification')).toBeNull();
  });

  it('when the contract itself is rate-limited: busy notice, no status, archive labelled as such', async () => {
    const chain = installChain({ contractId: PILOT.terms.contractId, codeHash: APPROVED });
    chain.requests.set(PILOT.terms.id, PILOT);
    vi.stubGlobal('fetch', async () => new Response('Too Many Requests', { status: 429 }));
    const setup = readySetup(chain, false, APPROVED, rateLimited(418_000));
    renderWithChain(<ReceiptScreen id={PILOT.terms.id} />, { setup, adapter: recordingWallet(null).adapter });
    expect(await screen.findByText('NEAR Testnet RPC is busy', {}, { timeout: 15000 })).toBeTruthy();
    const archived = screen.getByTestId('archived-verification');
    expect(archived.textContent).toContain('could not be read just now');
    expect(document.querySelector('[data-receipt-status]')).toBeNull();
  }, 20000);
});
