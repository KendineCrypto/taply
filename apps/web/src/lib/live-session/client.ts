'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FLAGS } from '@/lib/flags/features';

/**
 * Live Handshake client: room calls, local tokens and a visibility-aware 2 s
 * poll. The room is coordination only; payment status always comes from the
 * chain reads on the payment screen.
 */
export type LiveRole = 'merchant' | 'customer';
export type LivePresenceState = 'viewing' | 'reviewing' | 'paying';
export interface LivePresence { readonly online: boolean; readonly lastSeenMs: number | null; readonly state: LivePresenceState | null }
export interface LiveEvent { readonly seq: number; readonly type: string; readonly atMs: number }
export interface LiveSnapshot {
  readonly schema: 'taply.live-room.v1';
  readonly roomId: string;
  readonly requestId: string;
  readonly role: LiveRole;
  readonly serverTimeMs: number;
  readonly expiresAtMs: number;
  readonly expired: boolean;
  readonly closed: boolean;
  readonly merchant: LivePresence;
  readonly customer: LivePresence & { readonly joined: boolean };
  readonly events: readonly LiveEvent[];
}
export type LiveErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'EXPIRED' | 'CLOSED' | 'ALREADY_JOINED' | 'UNAVAILABLE' | 'REQUEST_NOT_OPEN' | 'RATE_LIMITED' | 'BAD_REQUEST';
export class LiveError extends Error {
  constructor(readonly code: LiveErrorCode, readonly requestId?: string) {
    super(`live:${code}`);
    this.name = 'LiveError';
  }
}

export const LIVE_POLL_MS = 2_000;
const MERCHANT_KEY = 'taply.live.merchant.v1:';
const CUSTOMER_KEY = 'taply.live.customer.v1:';
const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{22,64}$/;

async function call<T>(path: string, body: unknown, fetcher: typeof fetch = (u, i) => globalThis.fetch(u, i)): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit' });
  } catch {
    throw new LiveError('UNAVAILABLE');
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    throw new LiveError('UNAVAILABLE');
  }
  if (!response.ok) {
    const p = parsed as { error?: string; requestId?: string } | null;
    const code = (p?.error ?? 'UNAVAILABLE') as LiveErrorCode;
    throw new LiveError(code, typeof p?.requestId === 'string' ? p.requestId : undefined);
  }
  return parsed as T;
}

export interface MerchantRoom { readonly roomId: string; readonly merchantToken: string; readonly joinToken: string; readonly requestId: string; readonly expiresAtMs: number }

export const liveApi = {
  create: (requestId: string) => call<MerchantRoom>('/api/handshake/rooms', { requestId }),
  join: (roomId: string, joinToken: string, participantToken: string) =>
    call<{ requestId: string; rejoined: boolean }>(`/api/handshake/rooms/${roomId}`, { action: 'join', joinToken, participantToken }),
  sync: (roomId: string, role: LiveRole, token: string, state?: LivePresenceState) =>
    call<LiveSnapshot>(`/api/handshake/rooms/${roomId}`, { action: 'sync', role, token, ...(role === 'customer' && state ? { state } : {}) }),
  close: (roomId: string, token: string) => call<{ closed: boolean }>(`/api/handshake/rooms/${roomId}`, { action: 'close', token }),
};

let health: Promise<boolean> | null = null;
/** The flag is on AND the server has its room store. Checked once per page. */
export function useLiveAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(FLAGS.handshake.enabled ? null : false);
  useEffect(() => {
    if (!FLAGS.handshake.enabled) return;
    health ??= globalThis
      .fetch('/api/handshake/health', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ available?: boolean }>)
      .then((b) => b.available === true)
      .catch(() => false);
    let alive = true;
    void health.then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

export function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    // Storage unavailable: the session simply does not survive a reload.
  }
}
export const liveStore = {
  merchant: (requestId: string) => {
    const v = read<MerchantRoom>(MERCHANT_KEY + requestId);
    return v && ROOM_ID.test(v.roomId) && TOKEN.test(v.merchantToken) && TOKEN.test(v.joinToken) && v.expiresAtMs > Date.now() ? v : null;
  },
  saveMerchant: (room: MerchantRoom | null, requestId: string) => write(MERCHANT_KEY + requestId, room),
  participant: (roomId: string) => {
    const v = read<string>(CUSTOMER_KEY + roomId);
    return typeof v === 'string' && TOKEN.test(v) ? v : null;
  },
  saveParticipant: (roomId: string, token: string) => write(CUSTOMER_KEY + roomId, token),
};

/**
 * Polls `sync` every 2 s while the page is visible. A hidden page stops
 * announcing itself, so the other phone sees it go offline after ~8 s and
 * "reconnected" when it comes back.
 */
export function useLiveSync(target: { roomId: string; role: LiveRole; token: string; state?: LivePresenceState } | null) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<LiveError | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const key = target === null ? null : `${target.roomId}|${target.role}|${target.token}|${target.state ?? ''}`;
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
  });
  const tick = useCallback(async () => {
    const t = latest.current;
    if (t === null) return;
    try {
      const next = await liveApi.sync(t.roomId, t.role, t.token, t.state);
      setSnapshot(next);
      setReceivedAt(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof LiveError ? e : new LiveError('UNAVAILABLE'));
    }
  }, []);
  useEffect(() => {
    if (key === null) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null || document.visibilityState !== 'visible') return;
      void tick();
      timer = setInterval(() => void tick(), LIVE_POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [key, tick]);
  return { snapshot, error, receivedAt, refresh: tick };
}
