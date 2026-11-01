import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentScreen } from '../PaymentScreen';
import { FIXTURES, installChain, memoryStorage, readySetup, recordingWallet, renderWithChain } from '@/test/chain';
import { JOURNAL_STORAGE_KEY, SubmissionJournal } from '@/lib/payments/journal';
import { VerifierRpcError } from '@/lib/verify/rpc';
import type { VerifierRpc } from '@/lib/verify/rpc';
import { hashOf } from '@/lib/verify/__tests__/fake-chain';

/**
 * A mobile wallet redirect reloads the page: the signing promise is gone and
 * only the journal (written before the wallet opened) and the return URL remain.
 */

const { openRestricted } = FIXTURES;
const PAYER = openRestricted.terms.permittedPayerAccountId ?? 'payer.testnet';
const TX = hashOf('redirect-screen-tx');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function knownTx(): VerifierRpc {
  return {
    providerId: 'fake',
    async call(method, params) {
      const p = params as { tx_hash: string; sender_account_id: string };
      if (method !== 'EXPERIMENTAL_tx_status' || p.tx_hash !== TX || p.sender_account_id !== PAYER) {
        throw new VerifierRpcError('UNKNOWN_TRANSACTION');
      }
      const args = Buffer.from(
        JSON.stringify({ id: openRestricted.terms.id, expectedTermsHash: openRestricted.termsHash }),
      ).toString('base64');
      return {
        transaction: {
          hash: TX,
          signer_id: PAYER,
          receiver_id: openRestricted.terms.contractId,
          actions: [{ FunctionCall: { method_name: 'pay_instant_native', args, gas: 1, deposit: '1' } }],
        },
      };
    },
  };
}

describe('wallet redirect recovery on /pay/[id]', () => {
  it('binds the returned hash, strips the URL and asks the wallet for nothing', async () => {
    const chain = installChain({ contractId: openRestricted.terms.contractId });
    chain.requests.set(openRestricted.terms.id, openRestricted);
    const storage = memoryStorage();
    new SubmissionJournal(storage).begin({
      method: 'pay_instant_native',
      network: 'near-testnet',
      contractId: openRestricted.terms.contractId,
      requestId: openRestricted.terms.id,
      termsHash: openRestricted.termsHash,
      signerAccountId: PAYER,
      terms: null,
      operationNonce: null,
    });
    window.history.replaceState(null, '', `/pay/${openRestricted.terms.id}?transactionHashes=${TX}`);
    const { adapter, signed } = recordingWallet(PAYER);

    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, {
      setup: readySetup(chain, true, undefined, knownTx()),
      adapter,
      storage,
    });

    await waitFor(() => {
      const journal = JSON.parse(storage.data.get(JOURNAL_STORAGE_KEY) ?? '{}') as {
        entries: Array<{ transactionHash: string | null }>;
      };
      expect(journal.entries[0]?.transactionHash).toBe(TX);
    });
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe(`/pay/${openRestricted.terms.id}`);
    expect(signed).toEqual([]);
    // The explorer link for the recovered attempt appears.
    expect(await screen.findByText(TX)).toBeTruthy();
  });
});

describe('a redirect that loses the transaction reference never resubmits', () => {
  it.each([
    ['wallet error code', '?errorCode=Error&errorMessage=Something'],
    ['hash the chain does not know yet', `?transactionHashes=${hashOf('not-yet-indexed')}`],
    ['no parameters at all (wallet returned nothing)', ''],
  ])('%s: attempt stays blocked, no wallet request is made', async (_label, search) => {
    const chain = installChain({ contractId: openRestricted.terms.contractId });
    // Still OPEN and fundable on chain: the dangerous case for a blind retry.
    chain.requests.set(openRestricted.terms.id, openRestricted);
    const storage = memoryStorage();
    new SubmissionJournal(storage).begin({
      method: 'pay_instant_native',
      network: 'near-testnet',
      contractId: openRestricted.terms.contractId,
      requestId: openRestricted.terms.id,
      termsHash: openRestricted.termsHash,
      signerAccountId: PAYER,
      terms: null,
      operationNonce: null,
    });
    window.history.replaceState(null, '', `/pay/${openRestricted.terms.id}${search}`);
    const { adapter, signed } = recordingWallet(PAYER);

    renderWithChain(<PaymentScreen id={openRestricted.terms.id} />, {
      setup: readySetup(chain, true, undefined, knownTx()),
      adapter,
      storage,
    });

    // The previous attempt is shown as unresolved...
    expect(await screen.findByText('Your attempts from this browser')).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(''));
    // ...and no enabled approve control exists while it is unexplained.
    const approve = screen.queryByRole('button', { name: 'Approve in wallet' }) as HTMLButtonElement | null;
    expect(approve === null || approve.disabled).toBe(true);
    for (const button of screen.queryAllByRole('button')) {
      if (!(button as HTMLButtonElement).disabled) button.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(signed).toEqual([]);
    const journal = JSON.parse(storage.data.get(JOURNAL_STORAGE_KEY) ?? '{}') as { entries: Array<{ phase: string }> };
    expect(journal.entries[0]?.phase).not.toBe('USER_REJECTED');
    expect(journal.entries[0]?.phase).not.toBe('RESOLVED');
  });
});

describe('static guard: redirect recovery cannot sign', () => {
  it('wallet-return.ts has no access to any signing API', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(`${process.cwd()}/src/lib/payments/wallet-return.ts`, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/signAndSend|WalletAdapter|near-connect|submitCall|broadcast_tx|send_tx/);
    // Only these modules are imported: schemas, read-only RPC types, the journal.
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./journal', '@/lib/verify/rpc', '@/lib/verify/rpc', 'zod']);
  });
});
