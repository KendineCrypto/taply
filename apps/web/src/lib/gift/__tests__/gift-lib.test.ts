import { describe, expect, it } from 'vitest';
import type { GiftView } from '@taply/near-client';
import { GIFT_DESIGNS, giftSecretFromHash, openGiftUrl, personalGiftFromHash, personalGiftUrl, xShareUrl } from '../link';
import { formatRemaining, giftMessageError, validateGiftAmount } from '../create';
import { canClaim, deriveGiftUi, remainingMs } from '../status';
import { resolveGiftSetup } from '../setup';
import { claimAttempt, createdGift, saveGift } from '../store';

const ID = '0123456789abcdef0123456789abcdef';
const seed = new Uint8Array(32).fill(7);
const ONE = 10n ** 24n;
const gift = (over: Partial<GiftView> = {}): GiftView => ({
  id: ID, creator: 'alice.testnet', amountYocto: ONE.toString(), publicKey: 'ab'.repeat(32), message: 'hi', design: 1,
  createdAtNs: '1', createdHeight: '1', expiresAtNs: '5000000000000', status: 'AVAILABLE', beneficiary: null, settledAtNs: null,
  settledHeight: null, payout: null, payoutNonce: null, ...over,
});
const claimed = (beneficiary: string, payout: 'PENDING' | 'CONFIRMED' | 'FAILED') =>
  gift({ status: 'CLAIMED', beneficiary, settledAtNs: '2', settledHeight: '3', payout, payoutNonce: 1 });

describe('gift links', () => {
  it('open gift: secret only in the fragment, round-trips exactly', () => {
    const url = openGiftUrl('https://taplyapp.xyz', ID, seed);
    expect(url).toBe(`https://taplyapp.xyz/gift/${ID}#k=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc`);
    expect(giftSecretFromHash(new URL(url).hash)).toEqual(seed);
    for (const bad of ['', '#k=', '#k=abc', '#x=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc', '#k=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw!'])
      expect(giftSecretFromHash(bad)).toBeNull();
    expect(() => openGiftUrl('http://localhost:3000', ID, seed)).toThrow();
    expect(() => openGiftUrl('https://taplyapp.xyz', 'NOPE', seed)).toThrow();
  });

  it('personal gift payload is validated (message size, accounts, amount)', () => {
    const payload = { v: 1 as const, tx: 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su', from: 'alice.testnet', to: 'bob.testnet', amt: ONE.toString(), msg: 'Happy birthday 🎂', d: 2 };
    const url = personalGiftUrl('https://taplyapp.xyz', payload);
    expect(url.startsWith('https://taplyapp.xyz/gift/p#g=')).toBe(true);
    expect(personalGiftFromHash(new URL(url).hash)).toEqual(payload);
    expect(personalGiftFromHash('#g=!!!')).toBeNull();
    const enc = (v: unknown) => '#g=' + Buffer.from(JSON.stringify(v)).toString('base64url');
    expect(personalGiftFromHash(enc(payload))).toEqual(payload);
    expect(personalGiftFromHash(enc({ ...payload, amt: '1.5' }))).toBeNull();
    expect(personalGiftFromHash(enc({ ...payload, extra: 1 }))).toBeNull();
    expect(personalGiftFromHash(enc({ ...payload, to: 'Not An Account' }))).toBeNull();
    expect(() => personalGiftUrl('https://taplyapp.xyz', { ...payload, msg: 'x'.repeat(281) })).toThrow();
  });

  it('X intent encodes text and URL (fragment included), nothing posted automatically', () => {
    const link = `https://taplyapp.xyz/gift/${ID}#k=abc_-`;
    const href = xShareUrl('I just dropped a gift on Taply. 🎁 First to claim wins.', link);
    const parsed = new URL(href);
    expect(parsed.origin).toBe('https://x.com');
    expect(parsed.pathname).toBe('/intent/tweet');
    expect(parsed.searchParams.get('text')).toBe('I just dropped a gift on Taply. 🎁 First to claim wins.');
    expect(parsed.searchParams.get('url')).toBe(link);
    expect(href).not.toContain('#k=');
    expect(href).toContain('%23k%3Dabc_-');
  });

  it('has four envelope designs', () => {
    expect(GIFT_DESIGNS.map((d) => d.key)).toEqual(['forest', 'lime', 'linen', 'midnight']);
  });
});

describe('amount and message validation', () => {
  const limits = { minYocto: ONE / 100n, maxYocto: 100n * ONE, extraYocto: ONE / 100n, availableYocto: 5n * ONE };
  it('converts exactly and enforces limits and balance', () => {
    expect(validateGiftAmount('1', limits)).toEqual({ ok: true, yocto: ONE.toString() });
    expect(validateGiftAmount('0,5', limits)).toEqual({ ok: true, yocto: (ONE / 2n).toString() });
    expect(validateGiftAmount('', limits)).toEqual({ ok: false, error: 'required' });
    expect(validateGiftAmount('abc', limits)).toEqual({ ok: false, error: 'invalid' });
    expect(validateGiftAmount('-1', limits)).toEqual({ ok: false, error: 'invalid' });
    expect(validateGiftAmount('1e3', limits)).toEqual({ ok: false, error: 'invalid' });
    expect(validateGiftAmount('0.009', limits)).toEqual({ ok: false, error: 'tooSmall' });
    expect(validateGiftAmount('101', { ...limits, availableYocto: null })).toEqual({ ok: false, error: 'tooLarge' });
    expect(validateGiftAmount('0.0000000000000000000000001', limits)).toEqual({ ok: false, error: 'precision' });
    // 4.99 + 0.01 fee + 0.01 gas reserve > 5
    expect(validateGiftAmount('4.99', limits)).toEqual({ ok: false, error: 'balance' });
    expect(validateGiftAmount('4.98', limits).ok).toBe(true);
  });
  it('message rules match the contract', () => {
    expect(giftMessageError('🎁'.repeat(70))).toBeNull();
    expect(giftMessageError('🎁'.repeat(71))).toBe('tooLong');
    expect(giftMessageError('line\nbreak')).toBeNull();
    expect(giftMessageError('bell\u0007')).toBe('invalid');
  });
  it('formats remaining time', () => {
    expect(formatRemaining(0)).toBe('0m 00s');
    expect(formatRemaining(65_000)).toBe('1m 05s');
    expect(formatRemaining(3_600_000 * 23 + 59 * 60_000)).toBe('23h 59m');
    expect(formatRemaining(3 * 86_400_000 + 3_600_000)).toBe('3d 1h');
    expect(remainingMs('5000000000000', '4000000000000')).toBe(1_000_000);
    expect(remainingMs('5000000000000', '6000000000000')).toBe(0);
  });
});

describe('claim state transitions (chain is the only authority)', () => {
  const ok = (g: GiftView | null) => ({ status: 'ok' as const, gift: g });
  it('maps every required state', () => {
    expect(deriveGiftUi({ read: { status: 'loading' }, me: null, local: 'idle' }).kind).toBe('loading');
    expect(deriveGiftUi({ read: { status: 'error' }, me: 'bob.testnet', local: { submitted: 'h' } }).kind).toBe('unavailable');
    expect(deriveGiftUi({ read: ok(null), me: null, local: 'idle' }).kind).toBe('not_found');
    expect(deriveGiftUi({ read: ok(gift()), me: null, local: 'idle' }).kind).toBe('available');
    expect(deriveGiftUi({ read: ok(gift()), me: null, local: 'connecting' }).kind).toBe('connecting');
    expect(deriveGiftUi({ read: ok(gift()), me: 'bob.testnet', local: 'awaiting_wallet' }).kind).toBe('awaiting_wallet');
    expect(deriveGiftUi({ read: ok(gift()), me: 'bob.testnet', local: { submitted: 'hash' } })).toMatchObject({ kind: 'submitted', txHash: 'hash' });
    expect(deriveGiftUi({ read: ok(claimed('bob.testnet', 'PENDING')), me: 'bob.testnet', local: { submitted: 'h' } }).kind).toBe('claim_pending');
    expect(deriveGiftUi({ read: ok(claimed('bob.testnet', 'CONFIRMED')), me: 'bob.testnet', local: 'idle' }).kind).toBe('claimed');
    expect(deriveGiftUi({ read: ok(claimed('bob.testnet', 'FAILED')), me: 'bob.testnet', local: 'idle' }).kind).toBe('payout_failed');
    expect(deriveGiftUi({ read: ok(claimed('carol.testnet', 'CONFIRMED')), me: 'bob.testnet', local: { submitted: 'h' } }).kind).toBe('already_claimed');
    expect(deriveGiftUi({ read: ok(claimed('carol.testnet', 'CONFIRMED')), me: null, local: 'idle' }).kind).toBe('already_claimed');
    expect(deriveGiftUi({ read: ok(gift({ status: 'EXPIRED' })), me: 'bob.testnet', local: 'awaiting_wallet' }).kind).toBe('expired');
    const refunded = (payout: 'PENDING' | 'CONFIRMED') => gift({ status: 'REFUNDED', beneficiary: 'alice.testnet', settledAtNs: '2', settledHeight: '3', payout, payoutNonce: 1 });
    expect(deriveGiftUi({ read: ok(refunded('PENDING')), me: 'alice.testnet', local: 'idle' }).kind).toBe('refund_pending');
    expect(deriveGiftUi({ read: ok(refunded('CONFIRMED')), me: 'alice.testnet', local: 'idle' }).kind).toBe('refunded');
  });
  it('a wallet hash alone never shows success', () => {
    const ui = deriveGiftUi({ read: ok(gift()), me: 'bob.testnet', local: { submitted: 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su' } });
    expect(ui.kind).not.toBe('claimed');
    expect(deriveGiftUi({ read: { status: 'error' }, me: 'bob.testnet', local: { submitted: 'x' } }).kind).toBe('unavailable');
  });
  it('creator cannot claim', () => {
    const ui = deriveGiftUi({ read: ok(gift()), me: 'alice.testnet', local: 'idle' });
    expect(canClaim(ui, 'alice.testnet')).toBe(false);
    expect(canClaim(ui, 'bob.testnet')).toBe(true);
  });
});

describe('setup and local store', () => {
  const hash = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';
  it('fails closed and refuses the payment contracts', () => {
    expect(resolveGiftSetup({ flag: false, contractId: 'gift.testnet', codeHash: hash, forbidden: [] }).status).toBe('flag_off');
    expect(resolveGiftSetup({ flag: true, contractId: undefined, codeHash: undefined, forbidden: [] }).status).toBe('not_configured');
    expect(resolveGiftSetup({ flag: true, contractId: 'gift.testnet', codeHash: 'nope', forbidden: [] }).status).toBe('invalid');
    expect(resolveGiftSetup({ flag: true, contractId: 'taply-pay-pilot-1.testnet', codeHash: hash, forbidden: [] }).status).toBe('refused');
    expect(resolveGiftSetup({ flag: true, contractId: 'escrow.testnet', codeHash: hash, forbidden: ['escrow.testnet'] }).status).toBe('refused');
    expect(resolveGiftSetup({ flag: true, contractId: 'gift.testnet', codeHash: hash, forbidden: [] })).toEqual({ status: 'ready', contractId: 'gift.testnet', expectedCodeHash: hash });
  });
  it('keeps the creator link and claim hash on this device only', () => {
    const data = new Map<string, string>();
    const s = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    saveGift({ kind: 'created', id: ID, secret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc', creator: 'alice.testnet', amountYocto: ONE.toString(),
      lifetimeS: 3600, message: '', design: 0, savedAt: 1, phase: 'draft', txHash: null }, s);
    saveGift({ kind: 'created', id: ID, secret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc', creator: 'alice.testnet', amountYocto: ONE.toString(),
      lifetimeS: 3600, message: '', design: 0, savedAt: 2, phase: 'submitted', txHash: 'h' }, s);
    expect(createdGift(ID, s)?.phase).toBe('submitted');
    saveGift({ kind: 'claim', id: ID, account: 'bob.testnet', savedAt: 3, phase: 'submitted', txHash: 'tx' }, s);
    expect(claimAttempt(ID, 'bob.testnet', s)?.txHash).toBe('tx');
    expect(claimAttempt(ID, 'carol.testnet', s)).toBeNull();
    data.set('taply.gifts.v1', '{corrupt');
    expect(createdGift(ID, s)).toBeNull();
  });
});
