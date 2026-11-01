import type { FeatureFlag, FlagState } from '@/lib/flags/features';
import type { HandshakeSession, SessionEvent } from '@/lib/protocol';

/**
 * Handshake session service boundary (freeze sections 6 and 8, docs/API.md).
 *
 * PENDING BACKEND. The Codex session service and on-chain session binding do
 * not exist yet, so the only implementation in this build is
 * `UNAVAILABLE_HANDSHAKE`, which refuses every call. A real adapter must be a
 * separate, reviewed module that talks to:
 *
 *   POST /api/v1/sessions                 merchant draft: id, public nonce, secret join token
 *   POST /api/v1/sessions/:id/bind        bind ONE verified, merchant-signed request
 *   POST /api/v1/sessions/:id/join        authenticated payer consumes the join secret
 *   POST /api/v1/sessions/:id/review      exactly { termsHash }
 *   GET  /api/v1/sessions/:id             authenticated snapshot (HandshakeSession)
 *   GET  /api/v1/sessions/:id/events      SSE hints (cookie auth, never a token in the URL)
 *   POST /api/v1/sessions/:id/close       coordination only; never mutates payment
 *
 * Trust rules any implementation must keep:
 *  - The session server is untrusted for funds. Nothing it returns can mark a
 *    payment paid; `subscribe` delivers HINTS that trigger a fresh chain read.
 *  - The comparison code shown to people is derived on this device from terms
 *    read from the contract (see present.ts), never copied from the server.
 *  - The join token stays out of logs, analytics, referrers and SSE URLs.
 */

export type HandshakeUnavailableReason =
  /** NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE is off (the default). */
  | 'flag_off'
  /** No reviewed session-service adapter is configured in this build. */
  | 'backend_not_connected';

export type HandshakeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: 'unavailable' | 'not_found' | 'expired' | 'forbidden' | 'network' };

export interface CreatedSession {
  readonly session: HandshakeSession;
  /** Customer join URL for the session QR. The secret travels only in its fragment. */
  readonly joinUrl: string;
}

export interface HandshakeAdapter {
  readonly availability: { readonly kind: 'available' } | { readonly kind: 'unavailable'; readonly reason: HandshakeUnavailableReason };
  createSession(input: { readonly merchantAccountId: string }): Promise<HandshakeResult<CreatedSession>>;
  bind(sessionId: string, intentId: string): Promise<HandshakeResult<HandshakeSession>>;
  join(sessionId: string, joinToken: string): Promise<HandshakeResult<HandshakeSession>>;
  getSession(sessionId: string): Promise<HandshakeResult<HandshakeSession>>;
  review(sessionId: string, termsHash: string): Promise<HandshakeResult<HandshakeSession>>;
  close(sessionId: string): Promise<HandshakeResult<HandshakeSession>>;
  /** Hints only: each event means "re-read the session and the chain", never "paid". */
  subscribe(sessionId: string, onHint: (event: SessionEvent) => void): () => void;
}

const refuse = async (): Promise<HandshakeResult<never>> => ({ ok: false, error: 'unavailable' });

function unavailable(reason: HandshakeUnavailableReason): HandshakeAdapter {
  return {
    availability: { kind: 'unavailable', reason },
    createSession: refuse,
    bind: refuse,
    join: refuse,
    getSession: refuse,
    review: refuse,
    close: refuse,
    subscribe: () => () => undefined,
  };
}

/** The only adapter this build ships: every call is refused. */
export const UNAVAILABLE_HANDSHAKE: HandshakeAdapter = unavailable('backend_not_connected');

/**
 * Chooses the adapter. The flag alone never makes Handshake live: a reviewed
 * backend adapter must also be supplied. With the flag off, even a supplied
 * adapter is ignored.
 */
export function resolveHandshakeAdapter(
  flags: Readonly<Record<FeatureFlag, FlagState>>,
  backend: HandshakeAdapter | null = null,
): HandshakeAdapter {
  if (!flags.handshake.enabled) return unavailable('flag_off');
  if (backend === null || backend.availability.kind !== 'available') return UNAVAILABLE_HANDSHAKE;
  return backend;
}
