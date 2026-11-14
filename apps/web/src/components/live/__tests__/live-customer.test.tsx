import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/testnet-provider';
import { LiveCustomerSession } from '../LiveSession';

/** Customer side of a live session against a stubbed room API (no Redis, no chain). */
const ROOM = 'R'.repeat(22);
const REQUEST = 'a'.repeat(64);
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
function stubApi(join: { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, body });
    if (body['action'] === 'join') return new Response(JSON.stringify(join.body), { status: join.status });
    return new Response(JSON.stringify({ schema: 'taply.live-room.v1', roomId: ROOM, requestId: REQUEST, role: 'customer', serverTimeMs: Date.now(),
      expiresAtMs: Date.now() + 600_000, expired: false, closed: false, merchant: { online: true, lastSeenMs: Date.now(), state: 'viewing' },
      customer: { online: true, lastSeenMs: Date.now(), state: 'reviewing', joined: true }, events: [] }), { status: 200 });
  }));
}
const view = () => render(
  <I18nProvider locale="en">
    <LiveCustomerSession roomId={ROOM}>{(id) => <p>payment for {id}</p>}</LiveCustomerSession>
  </I18nProvider>,
);
beforeEach(() => { calls.length = 0; window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('live session, customer side', () => {
  it('joins with the QR token once, drops the secret from the URL, then announces "reviewing" and shows the payment', async () => {
    window.history.replaceState(null, '', `/s/${ROOM}#j=${'J'.repeat(32)}`);
    stubApi({ status: 200, body: { requestId: REQUEST, rejoined: false } });
    view();
    expect(await screen.findByText(`payment for ${REQUEST}`)).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(calls[0]?.body).toMatchObject({ action: 'join', joinToken: 'J'.repeat(32) });
    const participant = String(calls[0]?.body['participantToken']);
    expect(participant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await waitFor(() => expect(calls.some((c) => c.body['action'] === 'sync' && c.body['state'] === 'reviewing' && c.body['token'] === participant)).toBe(true));
    expect(await screen.findByText('Merchant')).toBeTruthy();
    expect(screen.getByText(/Live status is coordination only/)).toBeTruthy();
  });

  it('a second phone with the same QR is told so, and can still pay the request', async () => {
    window.history.replaceState(null, '', `/s/${ROOM}#j=${'J'.repeat(32)}`);
    stubApi({ status: 409, body: { error: 'ALREADY_JOINED', requestId: REQUEST } });
    view();
    expect(await screen.findByText(/already open on another phone/)).toBeTruthy();
    expect(screen.getByText(`payment for ${REQUEST}`)).toBeTruthy();
    expect(calls.some((c) => c.body['action'] === 'sync')).toBe(false);
  });

  it('without a join token or an earlier join on this device there is nothing to join', async () => {
    window.history.replaceState(null, '', `/s/${ROOM}`);
    stubApi({ status: 200, body: {} });
    view();
    expect((await screen.findByTestId('live-failure')).getAttribute('data-code')).toBe('NOT_FOUND');
    expect(calls).toHaveLength(0);
  });
});
