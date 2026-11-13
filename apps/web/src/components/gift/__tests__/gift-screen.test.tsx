import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { verifyGiftClaim } from '@taply/near-client';
import { memoryStorage, recordingWallet, renderWithChain } from '@/test/chain';
import { GiftScreen } from '../GiftScreen';
import { GIFT_CONTRACT, GIFT_ID, PK7, READY, SECRET, claimedBy, fakeGiftReader, giftView } from './gift-fixtures';

beforeEach(() => {
  window.location.hash = `#k=${SECRET}`;
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
  window.localStorage.clear();
});
const state = () => screen.getByTestId('gift-state').getAttribute('data-state');

describe('GiftScreen (Open Gift)', () => {
  it('unwrap is visual only; claim is a separate, signer-bound transaction; success only from the chain', async () => {
    const chain = { gift: giftView() as ReturnType<typeof giftView> };
    const { adapter, signed } = recordingWallet('bob.testnet');
    renderWithChain(<GiftScreen id={GIFT_ID} setup={READY} reader={fakeGiftReader(chain)} />, { setup: { status: 'not_configured' }, adapter, storage: memoryStorage() });
    await waitFor(() => expect(state()).toBe('available'));
    const envelope = screen.getByRole('img', { name: 'Closed gift envelope' });
    expect(envelope.getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Unwrap/ }));
    expect(screen.getByRole('img', { name: 'Open gift envelope' }).getAttribute('data-open')).toBe('true');
    // Opening claimed nothing.
    expect(signed).toHaveLength(0);
    expect(state()).toBe('available');

    const claim = await screen.findByRole('button', { name: /Claim gift/ });
    await act(async () => {
      fireEvent.click(claim);
    });
    await waitFor(() => expect(signed).toHaveLength(1));
    const call = signed[0]?.call;
    if (call === undefined) throw new Error("no signing request");
    expect(call).toMatchObject({ receiverId: GIFT_CONTRACT, methodName: 'claim_gift', depositYocto: '0', gas: '50000000000000' });
    expect(call.args['gift_id']).toBe(GIFT_ID);
    // The link key signed a claim for bob, verifiable exactly as the contract does.
    expect(await verifyGiftClaim(crypto, PK7, GIFT_CONTRACT, GIFT_ID, 'bob.testnet', call.args['signature'] as string)).toBe(true);
    expect(await verifyGiftClaim(crypto, PK7, GIFT_CONTRACT, GIFT_ID, 'carol.testnet', call.args['signature'] as string)).toBe(false);
    // Wallet returned a hash, chain still shows AVAILABLE: "Claim submitted", not success.
    await waitFor(() => expect(state()).toBe('submitted'));
    expect(screen.queryByText('Claimed successfully')).toBeNull();

    chain.gift = claimedBy('bob.testnet', 'PENDING');
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(state()).toBe('claim_pending'));
    expect(screen.getByText(/never sends again automatically/)).toBeTruthy();

    chain.gift = claimedBy('bob.testnet', 'CONFIRMED');
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(state()).toBe('claimed'));
    expect(screen.getAllByText('bob.testnet').length).toBeGreaterThan(0);
    expect(screen.getByText('Confirmed on chain')).toBeTruthy();
  });

  it('already claimed: shows the winner and offers no claim', async () => {
    const { adapter, signed } = recordingWallet('carol.testnet');
    renderWithChain(<GiftScreen id={GIFT_ID} setup={READY} reader={fakeGiftReader({ gift: claimedBy('bob.testnet', 'CONFIRMED') })} />,
      { setup: { status: 'not_configured' }, adapter, storage: memoryStorage() });
    await waitFor(() => expect(state()).toBe('already_claimed'));
    expect(screen.getByText('Someone else claimed this gift first.')).toBeTruthy();
    expect(screen.getByText('bob.testnet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Claim gift/ })).toBeNull();
    expect(signed).toHaveLength(0);
  });

  it('expired: nobody can claim; only the creator sees "Take it back" (refund_gift)', async () => {
    const expired = giftView({ status: 'EXPIRED' });
    const bob = recordingWallet('bob.testnet');
    renderWithChain(<GiftScreen id={GIFT_ID} setup={READY} reader={fakeGiftReader({ gift: expired })} />, { setup: { status: 'not_configured' }, adapter: bob.adapter, storage: memoryStorage() });
    await waitFor(() => expect(state()).toBe('expired'));
    expect(screen.queryByRole('button', { name: /Claim gift/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Take it back/ })).toBeNull();
    cleanup();
    const alice = recordingWallet('alice.testnet');
    renderWithChain(<GiftScreen id={GIFT_ID} setup={READY} reader={fakeGiftReader({ gift: { ...expired, expiresAtNs: '1' } })} />,
      { setup: { status: 'not_configured' }, adapter: alice.adapter, storage: memoryStorage() });
    const back = await screen.findByRole('button', { name: /Take it back/ });
    await act(async () => {
      fireEvent.click(back);
    });
    await waitFor(() => expect(alice.signed).toHaveLength(1));
    expect(alice.signed[0]?.call).toMatchObject({ methodName: 'refund_gift', args: { gift_id: GIFT_ID }, depositYocto: '0' });
  });

  it('RPC failure: verification unavailable, never claimed, no claim button', async () => {
    const { adapter } = recordingWallet('bob.testnet');
    renderWithChain(<GiftScreen id={GIFT_ID} setup={READY} reader={fakeGiftReader({ gift: null, fail: true })} />, { setup: { status: 'not_configured' }, adapter, storage: memoryStorage() });
    await waitFor(() => expect(state()).toBe('unavailable'));
    expect(screen.getByText('Verification unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Claim gift/ })).toBeNull();
  });

  it('a link without the claim key cannot claim; the creator cannot claim their own gift', async () => {
    window.location.hash = '';
    const bob = recordingWallet('bob.testnet');
    renderWithChain(<GiftScreen id={GIFT_ID} setup={READY} reader={fakeGiftReader({ gift: giftView() })} />, { setup: { status: 'not_configured' }, adapter: bob.adapter, storage: memoryStorage() });
    expect(await screen.findByText('This link cannot claim')).toBeTruthy();
    cleanup();
    window.location.hash = `#k=${SECRET}`;
    const alice = recordingWallet('alice.testnet');
    renderWithChain(<GiftScreen id={GIFT_ID} setup={READY} reader={fakeGiftReader({ gift: giftView() })} />, { setup: { status: 'not_configured' }, adapter: alice.adapter, storage: memoryStorage() });
    expect(await screen.findByText(/This is your own gift/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Claim gift/ })).toBeNull();
  });

  it('off when no approved gift contract is configured', async () => {
    const { adapter } = recordingWallet(null);
    renderWithChain(<GiftScreen id={GIFT_ID} setup={{ status: 'not_configured' }} />, { setup: { status: 'not_configured' }, adapter, storage: memoryStorage() });
    expect(await screen.findByText('Open Gifts are off')).toBeTruthy();
  });
});
