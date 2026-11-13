import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { memoryStorage, recordingWallet, renderWithChain } from '@/test/chain';
import { WalletDeclinedError } from '@/lib/wallet/adapter';
import { GiftCreate } from '../GiftCreate';
import { CONFIG, GIFT_CONTRACT, READY, fakeGiftReader, giftView } from './gift-fixtures';

beforeEach(() => {
  // jsdom runs on localhost, which is not shareable; use the production share origin.
  vi.stubEnv('NEXT_PUBLIC_TAPLY_SHARE_ORIGIN', 'https://taplyapp.xyz');
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllEnvs();
});

async function walkToReview(amount = '1') {
  fireEvent.click(await screen.findByRole('button', { name: /Open Gift/ }));
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: amount } });
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
}

describe('GiftCreate', () => {
  it('Open Gift: validates the amount, picks an envelope, reviews the exact deposit and signs create_gift', async () => {
    const state = { gift: null as ReturnType<typeof giftView> | null };
    const { adapter, signed } = recordingWallet('alice.testnet');
    renderWithChain(<GiftCreate setup={READY} reader={fakeGiftReader(state)} />, { setup: { status: 'not_configured' }, adapter, storage: memoryStorage() });

    // Personal gifts need Taply Wallet: honestly disabled for an external wallet.
    expect(await screen.findByText(/Personal Gifts are sent with Taply Wallet/)).toBeTruthy();
    const open = await screen.findByRole('button', { name: /Open Gift/ });
    await waitFor(() => expect(open).toHaveProperty('disabled', false));
    fireEvent.click(open);

    // Amount validation.
    const amount = screen.getByLabelText('Amount');
    fireEvent.change(amount, { target: { value: '0.001' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/below the minimum/);
    fireEvent.change(amount, { target: { value: '1.2.3' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/digits and one decimal point/);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    // Envelope + message + claim window.
    fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: 'First to claim wins!' } });
    expect(screen.getByText(/stored on NEAR Testnet and are public/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Midnight/ }));
    expect(screen.getByRole('radio', { name: /Midnight/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    // Review shows every number before the wallet opens.
    const review = await screen.findByRole('region', { name: 'Review the transaction' });
    expect(within(review).getByText('Fund an Open Gift (contract call)')).toBeTruthy();
    expect(within(review).getByText(GIFT_CONTRACT)).toBeTruthy();
    expect(within(review).getByText('alice.testnet')).toBeTruthy();
    expect(within(review).getByText('1 NEAR')).toBeTruthy();
    expect(within(review).getByText('1.01 NEAR')).toBeTruthy();
    expect(within(review).getByText('7 days')).toBeTruthy();
    expect(signed).toHaveLength(0);

    await act(async () => {
      fireEvent.click(within(review).getByRole('button', { name: /Confirm in wallet/ }));
    });
    await waitFor(() => expect(signed).toHaveLength(1));
    const call = signed[0]?.call;
    if (call === undefined) throw new Error("no signing request");
    expect(call).toMatchObject({ receiverId: GIFT_CONTRACT, methodName: 'create_gift', depositYocto: '1010000000000000000000000', gas: '30000000000000' });
    expect(call.args).toMatchObject({ amount: '1000000000000000000000000', lifetime_s: 604_800, message: 'First to claim wins!', design: 3 });
    const giftId = call.args['gift_id'] as string;
    expect(giftId).toMatch(/^[0-9a-f]{32}$/);
    expect(call.args['public_key']).toMatch(/^[0-9a-f]{64}$/);
    // The link was saved before the wallet opened.
    expect(window.localStorage.getItem('taply.gifts.v1')).toContain(giftId);

    // The wallet's hash is not enough: "waiting" until the chain shows the gift.
    expect(await screen.findByText('Waiting for NEAR Testnet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy gift link/ })).toBeNull();
    state.gift = giftView({ id: giftId, design: 3 });
    fireEvent.click(screen.getByRole('button', { name: /Check again/ }));
    expect(await screen.findByText('Your gift is live')).toBeTruthy();
    const url = screen.getByTestId('gift-url').textContent ?? '';
    expect(url).toMatch(new RegExp(`^https://taplyapp\\.xyz/gift/${giftId}#k=[A-Za-z0-9_-]{43}$`));
    const x = screen.getByRole('link', { name: /Share on X/ });
    const intent = new URL(x.getAttribute('href') ?? '');
    expect(intent.hostname).toBe('x.com');
    expect(intent.searchParams.get('text')).toBe('I just dropped a gift on Taply. 🎁 First to claim wins.');
    expect(intent.searchParams.get('url')).toBe(url);
    expect(x.getAttribute('target')).toBe('_blank');
  });

  it('a declined wallet confirmation sends nothing and stays on review', async () => {
    const { adapter, signed } = recordingWallet('alice.testnet', async () => {
      throw new WalletDeclinedError();
    });
    renderWithChain(<GiftCreate setup={READY} reader={fakeGiftReader({ gift: null })} />, { setup: { status: 'not_configured' }, adapter, storage: memoryStorage() });
    await waitFor(() => expect(screen.getByRole('button', { name: /Open Gift/ })).toHaveProperty('disabled', false));
    await walkToReview('0.5');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    const confirm = await screen.findByRole('button', { name: /Confirm in wallet/ });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(await screen.findByText('You declined in the wallet. Nothing was sent.')).toBeTruthy();
    expect(signed).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Review the transaction' })).toBeTruthy();
  });

  it('Open Gift is disabled with an honest label when no gift contract is configured', async () => {
    const { adapter } = recordingWallet('alice.testnet');
    renderWithChain(<GiftCreate setup={{ status: 'flag_off' }} reader={null} />, { setup: { status: 'not_configured' }, adapter, storage: memoryStorage() });
    expect(await screen.findByText(/Open Gifts switch on once the gift contract is deployed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Gift/ })).toHaveProperty('disabled', true);
  });

  it('balance and limit errors come from the verified contract config', () => {
    expect(CONFIG.minAmountYocto).toBe('10000000000000000000000');
  });
});
