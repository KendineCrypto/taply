import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NearTestnetClient } from '@taply/near-client';
import { SEND_SIGNER_AVAILABLE, SendFlow, recipientFormatCheck } from '../SendFlow';
import { readySetup, installChain, recordingWallet, renderWithChain } from '@/test/chain';

/** /send: real reads (recipient + balance) through an injected client; confirming is gated. */

const ME = 'alice.testnet';
type Client = Pick<NearTestnetClient, 'readAccount' | 'readNativeBalance'>;

function block() {
  return { hash: '11111111111111111111111111111113', height: '100', timestampNs: '1793476890000000000' };
}

function fakeClient(existing: ReadonlyArray<string>, balanceYocto = '5000000000000000000000000'): Client {
  const observation = <T,>(data: T) => ({
    source: 'rpc' as const,
    assurance: 'verified_final' as const,
    data,
    observedBlock: block(),
    checkedAt: '2026-11-01T10:00:00.000Z',
    stale: false,
    rpcAvailable: true,
  });
  return {
    readAccount: vi.fn(async (accountId: string) =>
      existing.includes(accountId)
        ? {
            observation: observation({ accountId, amountYoctoNear: '1', lockedYoctoNear: '0', storageUsageBytes: '182', codeHash: '11111111111111111111111111111111' }),
            error: null,
          }
        : {
            observation: { ...observation(null), data: null, observedBlock: null, assurance: 'unknown' as const },
            error: { code: 'ACCOUNT_NOT_FOUND' as const, messageKey: 'nearClient.errors.ACCOUNT_NOT_FOUND' as const, retry: 'NONE' as const, providerId: 'test' },
          },
    ) as unknown as Client['readAccount'],
    readNativeBalance: vi.fn(async (accountId: string) => ({
      observation: observation({ accountId, assetId: 'near:native' as const, amountYoctoNear: balanceYocto, lockedYoctoNear: '0', storageUsageBytes: '182' }),
      error: null,
    })) as unknown as Client['readNativeBalance'],
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderSend(client: Client) {
  const chain = installChain({ contractId: 'pay.testnet' });
  const wallet = recordingWallet(ME);
  renderWithChain(<SendFlow client={client} />, { setup: readySetup(chain, true), adapter: wallet.adapter });
  await screen.findByLabelText('To');
  return wallet;
}

async function type(label: string, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

describe('recipient checks (no network needed)', () => {
  it('classifies format problems before asking the chain', () => {
    expect(recipientFormatCheck('', ME)?.kind).toBe('empty');
    expect(recipientFormatCheck('Not Valid!', ME)?.kind).toBe('invalid');
    expect(recipientFormatCheck('bob.near', ME)?.kind).toBe('mainnet');
    expect(recipientFormatCheck(ME, ME)?.kind).toBe('self');
    expect(recipientFormatCheck('bob.testnet', ME)).toBeNull();
  });
});

describe('/send', () => {
  it('confirming is not available in this build', () => {
    expect(SEND_SIGNER_AVAILABLE).toBe(false);
  });

  it('checks the recipient on Testnet, shows the balance, reviews exactly, and never signs', async () => {
    const client = fakeClient(['bob.testnet']);
    const { signed } = await renderSend(client);
    expect(screen.getByText('Sending not available yet')).toBeTruthy();
    expect(await screen.findByText('Available: 5 NEAR')).toBeTruthy();

    await type('To', 'bob.testnet');
    expect(await screen.findByText('Account exists on NEAR Testnet', {}, { timeout: 2000 })).toBeTruthy();
    expect(client.readAccount).toHaveBeenCalledWith('bob.testnet');
    await type('Amount', '1.25');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByRole('heading', { name: 'Review transfer' })).toBeTruthy();
    expect(screen.getByText('bob.testnet')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm and send' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/Sending is disabled/)).toBeTruthy();
    fireEvent.click(confirm);
    expect(signed).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('1.25');
  });

  it('blocks review for a missing account', async () => {
    await renderSend(fakeClient([]));
    await type('To', 'ghost.testnet');
    expect(await screen.findByText('This account does not exist on NEAR Testnet', {}, { timeout: 2000 })).toBeTruthy();
    await type('Amount', '1');
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses mainnet-looking and self recipients without a chain read', async () => {
    const client = fakeClient(['bob.testnet']);
    await renderSend(client);
    await type('To', 'bob.near');
    expect(screen.getByText(/looks like a mainnet account/)).toBeTruthy();
    await type('To', ME);
    expect(screen.getByText('This is your own account')).toBeTruthy();
    expect(client.readAccount).not.toHaveBeenCalled();
  });

  it('refuses an amount above the available balance (gas reserve kept)', async () => {
    await renderSend(fakeClient(['bob.testnet'], '1000000000000000000000000'));
    await type('To', 'bob.testnet');
    await screen.findByText('Account exists on NEAR Testnet', {}, { timeout: 2000 });
    await type('Amount', '1');
    expect(screen.getByText('More than your available balance')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
    await type('Amount', 'abc');
    expect(screen.getByText('Enter an amount like 1.5')).toBeTruthy();
  });

  it('asks to connect when no wallet is connected', async () => {
    const chain = installChain({ contractId: 'pay.testnet' });
    renderWithChain(<SendFlow client={fakeClient([])} />, { setup: readySetup(chain, true), adapter: recordingWallet(null).adapter });
    expect(await screen.findByText('Connect your Testnet wallet to send.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
  });
});
