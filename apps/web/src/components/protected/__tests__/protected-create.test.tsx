import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ProtectedReader } from '@taply/near-client';
import { PROTECTED, PROTECTED_CONTRACT } from '@/test/protected-fixtures';
import { BLOCK_HASH, CODE_HASH, memoryStorage, recordingWallet, renderWithChain } from '@/test/chain';
import { calculateTermsHash } from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';
import { buildProtectedTerms } from '@/lib/protected/create';
import { ProtectedCreate } from '../ProtectedCreate';

const NOW_NS = 1_793_520_000_000_000_000n;
const observation = { source: 'rpc' as const, assurance: 'verified_final' as const,
  observedBlock: { hash: BLOCK_HASH, height: '1000', timestampNs: NOW_NS.toString() },
  checkedAt: '2026-11-09T12:00:00.000Z', stale: false, rpcAvailable: true };

function reader(quotes: IntentTerms[]): ProtectedReader {
  return {
    readConfig: async () => ({ observation: { ...observation, data: PROTECTED.config }, error: null }),
    client: {
      quoteCreateRequest: async (terms: IntentTerms) => {
        quotes.push(terms);
        return { observation: { ...observation, data: { quoteVersion: '1', requestId: terms.id, termsHash: calculateTermsHash(terms),
          storageBytes: '700', depositYocto: '7000000000000000000000', gas: '30000000000000' } }, error: null };
      },
    } as unknown as ProtectedReader['client'],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Number.parseInt((NOW_NS / 1_000_000n).toString(), 10)));
});
afterEach(() => vi.useRealTimers());

describe('ProtectedCreate', () => {
  it('signs protected terms with the chosen window, anchored to chain time', async () => {
    const quotes: IntentTerms[] = [];
    const { adapter, signed } = recordingWallet('alice.testnet');
    renderWithChain(
      <ProtectedCreate setup={{ status: 'ready', contractId: PROTECTED_CONTRACT, expectedCodeHash: CODE_HASH, qaBuild: true }} reader={reader(quotes)} />,
      { setup: { status: 'not_configured' }, adapter, storage: memoryStorage(), now: () => Date.now() },
    );
    fireEvent.change(await screen.findByLabelText('Amount (NEAR)'), { target: { value: '0.25' } });
    fireEvent.change(screen.getByLabelText('Payer can cancel for'), { target: { value: '5m' } });
    const create = await screen.findByRole('button', { name: /Create Protected request in wallet/ });
    await waitFor(() => expect(create).toHaveProperty('disabled', false));
    await act(async () => {
      fireEvent.click(create);
    });
    await waitFor(() => expect(signed).toHaveLength(1));
    const terms = quotes[0];
    expect(terms).toMatchObject({ mode: 'protected', cancelDurationNs: '300000000000', amountBaseUnits: '250000000000000000000000',
      creatorAccountId: 'alice.testnet', fundingExpiresAtNs: (NOW_NS + 900_000_000_000n).toString() });
    expect(signed[0]?.call).toMatchObject({ methodName: 'create_request', depositYocto: '7000000000000000000000', args: { terms, quoteVersion: '1' } });
    expect(await screen.findByRole('link', { name: 'Open request' })).toHaveProperty('href', expect.stringContaining(`/protected/${terms?.id}`));
  });

  it('the payer field can be filled from saved contacts (exact account ID copied)', async () => {
    window.localStorage.setItem('taply.contacts.v1', JSON.stringify({ version: 1, contacts: [{
      id: 'contact-0001', label: 'Bob', accountId: 'bob.testnet', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    }] }));
    const { adapter } = recordingWallet('alice.testnet');
    renderWithChain(
      <ProtectedCreate setup={{ status: 'ready', contractId: PROTECTED_CONTRACT, expectedCodeHash: CODE_HASH, qaBuild: true }} reader={reader([])} />,
      { setup: { status: 'not_configured' }, adapter, storage: memoryStorage(), now: () => Date.now() },
    );
    fireEvent.click(await screen.findByTestId('contact-picker-open'));
    fireEvent.click(await screen.findByRole('button', { name: /Bob/ }));
    expect((screen.getByLabelText('Only this payer (optional)') as HTMLInputElement).value).toBe('bob.testnet');
    expect(await screen.findByTestId('contact-match')).toBeTruthy();
    window.localStorage.clear();
  });

  it('cannot create while the flag is off', () => {
    const { adapter } = recordingWallet('alice.testnet');
    renderWithChain(<ProtectedCreate setup={{ status: 'flag_off' }} reader={null} />, { setup: { status: 'not_configured' }, adapter });
    expect(screen.getByText('Protected Pay is not enabled here')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Create Protected request/ })).toBeNull();
  });
});

describe('buildProtectedTerms', () => {
  it('produces valid protected terms with the signed window and default funding lifetime', () => {
    const { terms, termsHash } = buildProtectedTerms({
      contractId: PROTECTED_CONTRACT, creatorAccountId: 'alice.testnet', creationNonce: 'ab'.repeat(32),
      form: { amountBaseUnits: '1', memo: '', permittedPayerAccountId: 'bob.testnet' }, chainNowNs: '1000', window: '1h',
    });
    expect(terms.cancelDurationNs).toBe('3600000000000');
    expect(terms.permittedPayerAccountId).toBe('bob.testnet');
    expect(termsHash).toBe(calculateTermsHash(terms));
  });
});
