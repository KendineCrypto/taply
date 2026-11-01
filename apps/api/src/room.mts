import type { HandshakeSession } from '../../../packages/shared/dist/index.js';

export const SESSION_FORMAT = 'taply.session-room.v1' as const;
export type PresenceState = 'joined' | 'active' | 'disconnected' | 'resumed';
export type PayerProgress = { phase: 'AWAITING_WALLET' | 'SUBMITTED' | 'OUTCOME_UNKNOWN' | 'USER_REJECTED'; transactionHash: string | null };
export type RoomSnapshot = {
  schemaVersion: 'taply.room.v1'; authority: 'coordination_only'; session: HandshakeSession;
  phase: 'WAITING_FOR_BIND' | 'WAITING_FOR_CUSTOMER' | 'WAITING_FOR_REVIEW' | 'WAITING_FOR_WALLET' | 'PENDING_CHAIN' | 'BLOCKED' | 'EXPIRED' | 'CLOSED';
  reviews: { merchant: boolean; payer: boolean };
  presence: { merchant: PresenceState; payer: PresenceState | null };
  payerProgress: PayerProgress | null;
};
export type RoomEvent = {
  schemaVersion: 'taply.room-event.v1'; eventId: string; sessionId: string; emittedAt: string;
  type: 'session.created' | 'session.bound' | 'session.joined' | 'session.reviewed' | 'session.presence' | 'session.expired' | 'session.closed' | 'payer.progress';
  room: RoomSnapshot;
};
export type RoomSync = {
  schemaVersion: 'taply.room-sync.v1'; sessionId: string; cursor: string; reset: boolean;
  serverTimeMs: number; room: RoomSnapshot; events: RoomEvent[];
};
export type RoomRecord = {
  sequence: number; events: RoomEvent[]; progress: PayerProgress | null;
  presence: { merchant: PresenceState; payer: PresenceState | null };
};
export function roomSnapshot(session: HandshakeSession, reviews: string[], room: RoomRecord): RoomSnapshot {
  const phase = session.state === 'EXPIRED' || session.state === 'CLOSED' ? session.state
    : room.progress?.phase === 'OUTCOME_UNKNOWN' ? 'BLOCKED'
      : room.progress?.phase === 'SUBMITTED' ? 'PENDING_CHAIN'
        : session.state === 'DRAFT' ? 'WAITING_FOR_BIND'
          : session.state === 'OPEN' ? 'WAITING_FOR_CUSTOMER'
            : session.state === 'PAIRED' ? 'WAITING_FOR_REVIEW' : 'WAITING_FOR_WALLET';
  return structuredClone({ schemaVersion: 'taply.room.v1', authority: 'coordination_only', session, phase,
    reviews: { merchant: reviews.includes(session.merchantAccountId), payer: session.payerAccountId !== null && reviews.includes(session.payerAccountId) },
    presence: room.presence, payerProgress: room.progress });
}

/** Finite authenticated catch-up, never a long-lived subscription. Every frame
 * is a complete replacement snapshot. IDs are scoped to this session only. */
export function roomEventStream(sync: RoomSync): string {
  const frame = (event: string, id: string, data: unknown) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return 'retry: 6000\n\n' + (sync.reset ? '' : sync.events.map(e => frame('room.changed', e.eventId, e)).join(''))
    + frame(sync.reset ? 'room.reset' : 'room.snapshot', sync.cursor, sync);
}
