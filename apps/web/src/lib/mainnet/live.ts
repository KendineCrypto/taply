'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Mainnet Live Handshake client. Same wire protocol as the Testnet client
 * (server/handshake/http.ts), but:
 *  - its own API base (`/api/mainnet/handshake`), served only by a mainnet build;
 *  - its own browser storage keys (`taply.mainnet.live.*`), so a Testnet room
 *    token can never be reused here and vice versa;
 *  - no feature-flag module from the Testnet build.
 * The room is coordination only: presence and the shared comparison code. The
 * payment state always comes from the contract read on the pay screen.
 */
export const MAINNET_LIVE_BASE = '/api/mainnet/handshake';
export const LIVE_POLL_MS = 2_000;
const MERCHANT_KEY = 'taply.mainnet.live.merchant.v1:';
const CUSTOMER_KEY = 'taply.mainnet.live.customer.v1:';
export const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;
export const TOKEN = /^[A-Za-z0-9_-]{22,64}$/;

export type LiveRole = 'merchant' | 'customer';
export type LivePresenceState = 'viewing' | 'reviewing' | 'paying';
export interface LivePresence { readonly online: boolean; readonly lastSeenMs: number | null; readonly state: LivePresenceState | null }
export interface LiveSnapshot {
  readonly roomId: string;
  readonly requestId: string;
  readonly role: LiveRole;
  readonly serverTimeMs: number;
  readonly expiresAtMs: number;
  readonly expired: boolean;
  readonly closed: boolean;
  readonly merchant: LivePresence;
  readonly customer: LivePresence & { readonly joined: boolean };
}
export interface MerchantRoom { readonly roomId: string; readonly merchantToken: string; readonly joinToken: string; readonly requestId: string; readonly expiresAtMs: number }
export type LiveErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'EXPIRED' | 'CLOSED' | 'ALREADY_JOINED' | 'UNAVAILABLE' | 'REQUEST_NOT_OPEN' | 'RATE_LIMITED' | 'BAD_REQUEST';
const CODES: ReadonlyArray<LiveErrorCode> = ['NOT_FOUND', 'FORBIDDEN', 'EXPIRED', 'CLOSED', 'ALREADY_JOINED', 'UNAVAILABLE', 'REQUEST_NOT_OPEN', 'RATE_LIMITED', 'BAD_REQUEST'];

export class LiveError extends Error {
  constructor(readonly code: LiveErrorCode) {
    super(`live:${code}`);
  }
}

export function createLiveApi(fetcher: typeof fetch = (u, i) => globalThis.fetch(u, i)) {
  async function call<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${MAINNET_LIVE_BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      throw new LiveError('UNAVAILABLE');
    }
    const parsed = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (!response.ok) {
      const code = CODES.find((c) => c === parsed?.error) ?? 'UNAVAILABLE';
      throw new LiveError(code);
    }
    if (parsed === null) throw new LiveError('UNAVAILABLE');
    return parsed as T;
  }
  return {
    create: (requestId: string) => call<MerchantRoom>('/rooms', { requestId }),
    join: (roomId: string, joinToken: string, participantToken: string) =>
      call<{ requestId: string; rejoined: boolean }>(`/rooms/${roomId}`, { action: 'join', joinToken, participantToken }),
    sync: (roomId: string, role: LiveRole, token: string, state?: LivePresenceState) =>
      call<LiveSnapshot>(`/rooms/${roomId}`, { action: 'sync', role, token, ...(role === 'customer' && state ? { state } : {}) }),
    close: (roomId: string, token: string) => call<{ closed: boolean }>(`/rooms/${roomId}`, { action: 'close', token }),
  };
}
export const liveApi = createLiveApi();

export function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `#j=<token>` from the merchant's QR link; anything else is ignored. */
export function joinTokenFromHash(hash: string): string | null {
  const match = /^#j=([A-Za-z0-9_-]{22,64})$/.exec(hash);
  return match?.[1] ?? null;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}
function write(key: string, value: unknown | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the session still works for this tab
  }
}

export const liveStore = {
  merchant(requestId: string): MerchantRoom | null {
    const v = read<MerchantRoom>(MERCHANT_KEY + requestId);
    return v && ROOM_ID.test(v.roomId) && TOKEN.test(v.merchantToken) && TOKEN.test(v.joinToken) && v.requestId === requestId && v.expiresAtMs > Date.now() ? v : null;
  },
  saveMerchant: (requestId: string, room: MerchantRoom | null) => write(MERCHANT_KEY + requestId, room),
  participant(roomId: string): string | null {
    const v = read<string>(CUSTOMER_KEY + roomId);
    return typeof v === 'string' && TOKEN.test(v) ? v : null;
  },
  saveParticipant: (roomId: string, token: string) => write(CUSTOMER_KEY + roomId, token),
  /** The join secret is kept (same browser only) so a reload can rejoin after the address bar was cleaned. */
  joinToken(roomId: string): string | null {
    const v = read<string>(`${CUSTOMER_KEY}${roomId}:j`);
    return typeof v === 'string' && TOKEN.test(v) ? v : null;
  },
  saveJoinToken: (roomId: string, token: string) => write(`${CUSTOMER_KEY}${roomId}:j`, token),
};

let health: Promise<boolean> | null = null;
export function useLiveAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    health ??= globalThis
      .fetch(`${MAINNET_LIVE_BASE}/health`, { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ available?: boolean }>)
      .then((b) => b.available === true)
      .catch(() => false);
    let alive = true;
    void health.then((ok) => alive && setAvailable(ok));
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

/** Polls `sync` while visible. Errors are shown; nothing here touches payment state. */
export function useLiveSync(target: { roomId: string; role: LiveRole; token: string; state?: LivePresenceState } | null) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<LiveError | null>(null);
  const key = target === null ? null : `${target.roomId}|${target.role}|${target.token}|${target.state ?? ''}`;
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
  });
  const tick = useCallback(async () => {
    const t = latest.current;
    if (t === null) return;
    try {
      setSnapshot(await liveApi.sync(t.roomId, t.role, t.token, t.state));
      setError(null);
    } catch (e) {
      setError(e instanceof LiveError ? e : new LiveError('UNAVAILABLE'));
    }
  }, []);
  useEffect(() => {
    if (key === null) return;
    void tick();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [key, tick]);
  return { snapshot, error, refresh: tick };
}
