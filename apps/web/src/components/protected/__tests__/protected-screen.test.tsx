import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { PaymentRequestRead, ProtectedReader, ReadResult } from '@taply/near-client';
import { PROTECTED, PROTECTED_CONTRACT } from '@/test/protected-fixtures';
import { BLOCK_HASH, CODE_HASH, memoryStorage, recordingWallet, renderWithChain } from '@/test/chain';
import { calculateTermsHash } from '@/lib/protocol';
import type { ContractRequest } from '@/lib/protocol';
import type { ProtectedSetup } from '@/lib/protected/setup';
import { ProtectedScreen } from '../ProtectedScreen';

const cutoff = BigInt(PROTECTED.locked.cancelUntilNs ?? '0');
const ready = (qaBuild: boolean): ProtectedSetup => ({ status: 'ready', contractId: PROTECTED_CONTRACT, expectedCodeHash: CODE_HASH, qaBuild });

function fakeReader(request: ContractRequest, atNs: bigint, balanceYocto = '100000000000000000000000000'): ProtectedReader {
  const block = { hash: BLOCK_HASH, height: '1000', timestampNs: atNs.toString() };
  const observation = { source: 'rpc' as const, assurance: 'verified_final' as const, observedBlock: block,
    checkedAt: '2026-11-09T12:00:00.000Z', stale: false, rpcAvailable: true };
  const read: ReadResult<PaymentRequestRead> = { observation: { ...observation, data: { id: request.terms.id, request } }, error: null };
  return {
    client: {
      readPaymentRequest: async () => read,
      readNativeBalance: async (accountId: string) => ({
        observation: { ...observation, data: { accountId, assetId: 'near:native', amountYoctoNear: balanceYocto, lockedYoctoNear: '0', storageUsageBytes: '182' } },
        error: null,
      }),
    } as unknown as ProtectedReader['client'],
    readConfig: async () => ({ observation: { ...observation, data: PROTECTED.config }, error: null }),
  };
}

function show(request: ContractRequest, atNs: bigint, account: string | null, setup: ProtectedSetup = ready(true), balanceYocto?: string, storage = memoryStorage()) {
  // Device clock = the observed block time, so the read counts as fresh.
  vi.setSystemTime(new Date(Number.parseInt((atNs / 1_000_000n).toString(), 10)));
  const wallet = recordingWallet(account);
  renderWithChain(<ProtectedScreen id={request.terms.id} setup={setup} reader={fakeReader(request, atNs, balanceYocto)} />, {
    // The G1 payments setup is irrelevant here; only its journal is used.
    setup: { status: 'not_configured' },
    adapter: wallet.adapter,
    storage,
    now: () => Date.now(),
  });
  return { ...wallet, storage };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ProtectedScreen gates', () => {
  it('is an honest notice while the flag is off, with nothing to tap', () => {
    show(PROTECTED.locked, cutoff - 1n, 'bob.testnet', { status: 'flag_off' });
    expect(screen.getByText('Protected Pay is not enabled here')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cancel|release|lock/i })).toBeNull();
  });

  it('refuses the G1 pilot as an escrow contract', () => {
    show(PROTECTED.locked, cutoff - 1n, 'bob.testnet', { status: 'pilot_refused' });
    expect(screen.getByText('Wrong contract for Protected Pay')).toBeTruthy();
  });

  it('a non-QA build reads the request but cannot sign against the unreviewed candidate', async () => {
    show(PROTECTED.locked, cutoff - 1n, 'bob.testnet', ready(false));
    expect(await screen.findByText('LOCKED - NOT PAID', { selector: 'p' })).toBeTruthy();
    expect(await screen.findByText('Signing is off')).toBeTruthy();
    const cancel = await screen.findByRole('button', { name: /Cancel and refund me/ });
    expect(cancel).toHaveProperty('disabled', true);
    expect(screen.queryByText(/Verified Paid/)).toBeNull();
  });
});

describe('ProtectedScreen actions (QA build)', () => {
  it('LOCKED before the cutoff: payer cancels with exactly 1 yoctoNEAR', async () => {
    const { signed } = show(PROTECTED.locked, cutoff - 30_000_000_000n, 'bob.testnet');
    expect(await screen.findByText('Unreviewed test contract')).toBeTruthy();
    expect(await screen.findByText('About 0:30 left to cancel')).toBeTruthy();
    const cancel = await screen.findByRole('button', { name: /Cancel and refund me/ });
    await waitFor(() => expect(cancel).toHaveProperty('disabled', false));
    expect(screen.queryByRole('button', { name: /Release to recipient/ })).toBeNull();
    await act(async () => {
      fireEvent.click(cancel);
    });
    await waitFor(() => expect(signed).toHaveLength(1));
    expect(signed[0]?.signer).toBe('bob.testnet');
    expect(signed[0]?.call).toMatchObject({
      receiverId: PROTECTED_CONTRACT,
      methodName: 'cancel_protected',
      depositYocto: '1',
      args: { id: PROTECTED.locked.terms.id, expectedTermsHash: PROTECTED.locked.termsHash },
    });
  });

  it('1 ns before the cutoff the estimate already reads zero but cancel stays offered', async () => {
    show(PROTECTED.locked, cutoff - 1n, 'bob.testnet');
    expect(await screen.findByText(/estimated cutoff has passed/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Cancel and refund me/ })).toBeTruthy();
  });

  it('the recipient sees no cancel and no early release', async () => {
    show(PROTECTED.locked, cutoff - 1n, 'alice.testnet');
    expect(await screen.findByText('LOCKED - NOT PAID', { selector: 'p' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cancel and refund me|Release to recipient/ })).toBeNull();
  });

  it('at the cutoff anyone may release, to the recipient only', async () => {
    const { signed } = show(PROTECTED.locked, cutoff, 'carol.testnet');
    const release = await screen.findByRole('button', { name: /Release to recipient/ });
    await waitFor(() => expect(release).toHaveProperty('disabled', false));
    expect(screen.queryByRole('button', { name: /Cancel and refund me/ })).toBeNull();
    await act(async () => {
      fireEvent.click(release);
    });
    await waitFor(() => expect(signed).toHaveLength(1));
    expect(signed[0]?.call).toMatchObject({ methodName: 'release_protected', depositYocto: '1', args: { id: PROTECTED.locked.terms.id } });
  });

  it('OPEN: the payer must accept the exact window before locking the exact amount', async () => {
    const { signed } = show(PROTECTED.open, BigInt(PROTECTED.open.createdAtNs), 'bob.testnet');
    expect(await screen.findByText(/You can cancel for 60 seconds starting when this payment funds on-chain/)).toBeTruthy();
    const lock = await screen.findByRole('button', { name: /Lock payment in wallet/ });
    expect(lock).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(lock).toHaveProperty('disabled', false));
    await act(async () => {
      fireEvent.click(lock);
    });
    await waitFor(() => expect(signed).toHaveLength(1));
    expect(signed[0]?.call).toMatchObject({
      methodName: 'fund_protected_native',
      depositYocto: PROTECTED.open.terms.amountBaseUnits,
      args: { acceptedCancelDurationNs: '60000000000', consentVersion: 'taply.protected-consent.v1' },
    });
  });

  it('a stale read never opens the wallet', async () => {
    const at = cutoff - 1n;
    const { signed } = show(PROTECTED.locked, at, 'bob.testnet');
    const cancel = await screen.findByRole('button', { name: /Cancel and refund me/ });
    await waitFor(() => expect(cancel).toHaveProperty('disabled', false));
    vi.setSystemTime(new Date(Number.parseInt((at / 1_000_000n).toString(), 10) + 120_000));
    await act(async () => {
      fireEvent.click(cancel);
    });
    expect(await screen.findByText('Review again')).toBeTruthy();
    expect(signed).toHaveLength(0);
  });
});

describe('ProtectedScreen error states', () => {
  it('warns when the balance cannot cover the amount plus gas', async () => {
    show(PROTECTED.open, BigInt(PROTECTED.open.createdAtNs), 'bob.testnet', ready(true), '1000');
    expect(await screen.findByText(/Lock payment in wallet/)).toBeTruthy();
    expect(await screen.findByText('Balance may be too low')).toBeTruthy();
  });

  it('terms altered after signing fail closed (hash mismatch)', async () => {
    const restricted = { ...PROTECTED.open, terms: { ...PROTECTED.open.terms, permittedPayerAccountId: 'dave.testnet' } };
    // Terms hash no longer matches: the view must fail closed rather than offer anything.
    show(restricted, BigInt(PROTECTED.open.createdAtNs), 'bob.testnet');
    expect(await screen.findByText('Chain data did not add up')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Lock payment in wallet/ })).toBeNull();
  });

  it('a payer restriction to another account blocks locking with an explicit notice', async () => {
    const terms = { ...PROTECTED.open.terms, permittedPayerAccountId: 'dave.testnet' };
    const restricted = { ...PROTECTED.open, terms, termsHash: calculateTermsHash(terms) };
    show(restricted, BigInt(PROTECTED.open.createdAtNs), 'bob.testnet');
    expect(await screen.findByText('Different payer required')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Lock payment in wallet/ })).toHaveProperty('disabled', true);
  });

  it('a cancel sent from this device that lost the race to the cutoff is explained', async () => {
    const storage = memoryStorage();
    const startedAt = new Date(Number.parseInt((cutoff / 1_000_000n).toString(), 10) - 5_000).toISOString();
    storage.setItem('taply.journal.v1', JSON.stringify({ version: 1, entries: [{
      method: 'cancel_protected', network: 'near-testnet', contractId: PROTECTED_CONTRACT, requestId: PROTECTED.locked.terms.id,
      termsHash: PROTECTED.locked.termsHash, signerAccountId: 'bob.testnet', terms: null, operationNonce: null,
      phase: 'SUBMITTED', transactionHash: BLOCK_HASH, startedAt, updatedAt: startedAt,
    }] }));
    show(PROTECTED.locked, cutoff + 1n, 'bob.testnet', ready(true), undefined, storage);
    expect(await screen.findByText('Cancellation window closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cancel and refund me/ })).toBeNull();
  });
});

describe('ProtectedScreen terminal states', () => {
  it('refunded says refunded and never paid', async () => {
    show(PROTECTED.refunded, BigInt(PROTECTED.refunded.latestOperation?.resolvedAtNs ?? '0') + 1n, 'bob.testnet');
    expect(await screen.findByText('Refunded — not a payment')).toBeTruthy();
    expect(screen.queryByText(/Paid per contract/)).toBeNull();
  });

  it('released shows contract-reported payment without a Verified claim', async () => {
    show(PROTECTED.paid, BigInt(PROTECTED.paid.latestOperation?.resolvedAtNs ?? '0') + 1n, 'alice.testnet');
    expect(await screen.findByText('Paid per contract (released)')).toBeTruthy();
    expect(screen.queryByText(/Verified Paid/)).toBeNull();
  });
});
