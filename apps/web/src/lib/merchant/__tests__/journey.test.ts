import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_HINT_KEY,
  CHECKOUT_HINT_MS,
  LIVE_WATCH_FAST_MS,
  LIVE_WATCH_FAST_WINDOW_MS,
  LIVE_WATCH_SLOW_MS,
  MAX_POS_SALES,
  POS_SALES_KEY,
  cameFromCheckout,
  groupCode,
  isPosSale,
  journeyContext,
  journeySide,
  liveWatchDelayMs,
  rememberCheckout,
  rememberPosSale,
  saleCode,
  shouldLiveWatch,
} from '../journey';
import type { HintStorage } from '../journey';
import { comparisonCode } from '@/lib/protocol';

const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const OTHER = 'a'.repeat(64);

function store(initial: Record<string, string> = {}): HintStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('journey side and sale code', () => {
  it('maps contract caller roles to receiver / payer', () => {
    expect(journeySide('recipient')).toBe('receiver');
    expect(journeySide('payer_and_recipient')).toBe('receiver');
    expect(journeySide('payer')).toBe('payer');
    expect(journeySide('observer')).toBe('payer');
    expect(journeySide('anonymous')).toBe('payer');
  });

  it('both phones derive the same six-character code from the same request ID, and a different one for another ID', () => {
    const code = saleCode(ID);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(saleCode(ID)).toBe(code);
    expect(code).toBe(comparisonCode(ID));
    expect(saleCode(OTHER)).not.toBe(code);
    expect(groupCode('4K7Q2M')).toBe('4K7 Q2M');
  });

  it('has no code for anything that is not a request ID', () => {
    expect(saleCode('')).toBeNull();
    expect(saleCode(ID.toUpperCase())).toBeNull();
    expect(saleCode(`${ID}0`)).toBeNull();
  });
});

describe('live watch (read-only, receiver of an open request only)', () => {
  const base = { status: 'OPEN', callerRole: 'recipient' as const, observedAtNs: '100', fundingExpiresAtNs: '200' };

  it('watches only the receiver of an OPEN, still payable request', () => {
    expect(shouldLiveWatch(base)).toBe(true);
    expect(shouldLiveWatch({ ...base, callerRole: 'payer_and_recipient' })).toBe(true);
    expect(shouldLiveWatch({ ...base, callerRole: 'payer' })).toBe(false);
    expect(shouldLiveWatch({ ...base, callerRole: 'observer' })).toBe(false);
    expect(shouldLiveWatch({ ...base, status: 'FINAL_PAID' })).toBe(false);
    expect(shouldLiveWatch({ ...base, status: 'PAYOUT_IN_FLIGHT' })).toBe(false);
    expect(shouldLiveWatch({ ...base, observedAtNs: '200' })).toBe(false);
  });

  it('re-reads every 5 s for ten minutes, then every 15 s', () => {
    expect(liveWatchDelayMs(0)).toBe(LIVE_WATCH_FAST_MS);
    expect(liveWatchDelayMs(LIVE_WATCH_FAST_WINDOW_MS - 1)).toBe(LIVE_WATCH_FAST_MS);
    expect(liveWatchDelayMs(LIVE_WATCH_FAST_WINDOW_MS)).toBe(LIVE_WATCH_SLOW_MS);
  });
});

describe('context hints (wording only)', () => {
  it('remembers POS sales, newest first, capped, ignoring anything that is not a request ID', () => {
    const s = store();
    rememberPosSale(s, ID);
    rememberPosSale(s, 'not-an-id');
    expect(isPosSale(s, ID)).toBe(true);
    expect(isPosSale(s, OTHER)).toBe(false);
    for (let i = 0; i < MAX_POS_SALES + 5; i += 1) rememberPosSale(s, i.toString(16).padStart(64, '0'));
    const ids = JSON.parse(s.data.get(POS_SALES_KEY) ?? '[]') as string[];
    expect(ids).toHaveLength(MAX_POS_SALES);
    expect(isPosSale(s, ID)).toBe(false);
  });

  it('survives corrupt, hostile or missing storage', () => {
    expect(isPosSale(store({ [POS_SALES_KEY]: '{not json' }), ID)).toBe(false);
    expect(isPosSale(store({ [POS_SALES_KEY]: JSON.stringify([ID.toUpperCase(), 42, null]) }), ID.toUpperCase())).toBe(false);
    expect(isPosSale(null, ID)).toBe(false);
    const throwing: HintStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => rememberPosSale(throwing, ID)).not.toThrow();
    expect(() => rememberCheckout(throwing, 'shop.testnet', 0)).not.toThrow();
    expect(cameFromCheckout(throwing, 'shop.testnet', 0)).toBe(false);
  });

  it('frames a payment as checkout only for the SAME receiving account, recently', () => {
    const s = store();
    const now = 1_000_000;
    rememberCheckout(s, 'shop.testnet', now);
    expect(cameFromCheckout(s, 'shop.testnet', now + 1000)).toBe(true);
    expect(cameFromCheckout(s, 'evil.testnet', now + 1000)).toBe(false);
    expect(cameFromCheckout(s, 'shop.testnet', now + CHECKOUT_HINT_MS + 1)).toBe(false);
    expect(cameFromCheckout(s, 'shop.testnet', now - 1)).toBe(false);
    expect(cameFromCheckout(store({ [CHECKOUT_HINT_KEY]: '"shop.testnet"' }), 'shop.testnet', now)).toBe(false);
  });

  it('chooses the context from the side first', () => {
    expect(journeyContext({ side: 'receiver', posSale: true, fromCheckout: true })).toBe('pos');
    expect(journeyContext({ side: 'receiver', posSale: false, fromCheckout: true })).toBe('request');
    expect(journeyContext({ side: 'payer', posSale: true, fromCheckout: true })).toBe('checkout');
    expect(journeyContext({ side: 'payer', posSale: true, fromCheckout: false })).toBe('request');
  });
});
