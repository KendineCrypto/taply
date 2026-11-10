import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_QR_WAIT_MS, useMerchantLiveSession } from '../LiveSession';

/**
 * The merchant QR must never change under a customer's camera: it waits for the
 * live room, then stays on ONE link (live, or the plain pay link as a fallback).
 */
vi.mock('@/lib/flags/features', () => ({ FLAGS: { handshake: { enabled: true } } }));

const REQUEST = 'b'.repeat(64);
const ROOM = { roomId: 'R'.repeat(22), merchantToken: 'M'.repeat(32), joinToken: 'J'.repeat(32), requestId: REQUEST, expiresAtMs: Date.now() + 3_600_000 };
let releaseCreate: (() => void) | null = null;

function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/handshake/health') return new Response(JSON.stringify({ available: true }));
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url === '/api/handshake/rooms') {
      await new Promise<void>((resolve) => { releaseCreate = resolve; });
      return new Response(JSON.stringify(ROOM));
    }
    if (body['action'] === 'sync') {
      return new Response(JSON.stringify({ schema: 'taply.live-room.v1', roomId: ROOM.roomId, requestId: REQUEST, role: 'merchant', serverTimeMs: Date.now(),
        expiresAtMs: ROOM.expiresAtMs, expired: false, closed: false, merchant: { online: true, lastSeenMs: Date.now(), state: 'viewing' },
        customer: { online: false, lastSeenMs: null, state: null, joined: false }, events: [] }));
    }
    return new Response('{}', { status: 404 });
  }));
}

const seen: string[] = [];
function Probe() {
  const s = useMerchantLiveSession(REQUEST);
  const link = s.qr === 'pending' ? 'pending' : s.qr === 'live' ? s.linkFor('https://taplyapp.xyz') : `https://taplyapp.xyz/pay/${REQUEST}`;
  if (seen.at(-1) !== link) seen.push(String(link));
  return null;
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  seen.length = 0;
  releaseCreate = null;
  window.localStorage.clear();
  vi.useFakeTimers();
  stubApi();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('merchant QR stays the same', () => {
  it('waits for the live room, then shows the live link only (no plain link first)', async () => {
    render(<Probe />);
    await flush();
    expect(seen).toEqual(['pending']);
    await act(async () => { vi.advanceTimersByTime(1_000); });
    releaseCreate?.();
    await flush();
    await act(async () => { vi.advanceTimersByTime(LIVE_QR_WAIT_MS * 3); });
    await flush();
    expect(seen).toEqual(['pending', `https://taplyapp.xyz/s/${ROOM.roomId}#j=${ROOM.joinToken}`]);
  });

  it('falls back to the plain pay link if the room is slow, and keeps it when the room arrives later', async () => {
    render(<Probe />);
    await flush();
    await act(async () => { vi.advanceTimersByTime(LIVE_QR_WAIT_MS + 10); });
    await flush();
    expect(seen).toEqual(['pending', `https://taplyapp.xyz/pay/${REQUEST}`]);
    releaseCreate?.();
    await flush();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(seen).toEqual(['pending', `https://taplyapp.xyz/pay/${REQUEST}`]);
  });
});
