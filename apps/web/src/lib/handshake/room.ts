import { z } from 'zod';
import { HandshakeSessionSchema, parseStrictJson } from '@taply/shared';
import type { FeatureFlag, FlagState } from '@/lib/flags/features';
import type { HandshakeSession, IntentTerms } from '@/lib/protocol';
import { presentHandshake } from './present';
import type { HandshakeRole } from './present';

/**
 * Phase 7G: frontend boundary for the shared payment ROOM (backend handoff
 * docs/PHASE_7_SHARED_ROOM.md, `GET /api/v1/sessions/:id/room`).
 *
 * Versioned and typed, but deliberately NOT live:
 *  - `resolveRoomAdapter` returns an unavailable adapter unless the Handshake
 *    flag is on AND a separately reviewed backend adapter is supplied. This
 *    build supplies none, and the flag is off.
 *  - Room data is COORDINATION ONLY. Nothing here can produce Paid, Paid per
 *    contract or Verified Paid: payment status is an INPUT from this device's
 *    own finalized chain read (and the independent verifier), shown next to
 *    the room, never derived from it.
 *  - Merchant identity is the literal type 'unverified'. There is no code path
 *    that can mark it verified; that needs a real wallet-signature (NEP-413)
 *    proof, which no reviewed adapter provides yet.
 *  - The comparison code is derived locally from chain terms (present.ts) and
 *    only compared with the server's. A matched code does not authenticate
 *    the merchant.
 *  - Events and syncs are hints: every applied change asks the caller to
 *    re-read the chain. A socket/server "submitted" never means paid.
 *
 * The schemas mirror apps/api/src/room.mts (API-owned). They are copied here,
 * not imported, because Node backend modules must not enter the browser bundle.
 * A schema version this build does not know is refused as `unsupported`.
 */

export const ROOM_SYNC_VERSION = 'taply.room-sync.v1' as const;
export const ROOM_VERSION = 'taply.room.v1' as const;
export const ROOM_EVENT_VERSION = 'taply.room-event.v1' as const;
export const ROOM_ADAPTER_VERSION = 'taply.room-adapter.v1' as const;

const Cursor = z.string().regex(/^(0|[1-9][0-9]*)$/).max(20);
const TxHash = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const PresenceStateSchema = z.enum(['joined', 'active', 'disconnected', 'resumed']);

const PayerProgressSchema = z
  .strictObject({
    phase: z.enum(['AWAITING_WALLET', 'SUBMITTED', 'OUTCOME_UNKNOWN', 'USER_REJECTED']),
    transactionHash: TxHash.nullable(),
  })
  .superRefine((p, ctx) => {
    if (p.phase === 'SUBMITTED' && p.transactionHash === null) ctx.addIssue({ code: 'custom', message: 'SUBMITTED needs a hash' });
    if ((p.phase === 'AWAITING_WALLET' || p.phase === 'USER_REJECTED') && p.transactionHash !== null) {
      ctx.addIssue({ code: 'custom', message: 'No hash before submission' });
    }
  });

export const RoomSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(ROOM_VERSION),
  authority: z.literal('coordination_only'),
  session: HandshakeSessionSchema,
  phase: z.enum(['WAITING_FOR_BIND', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_REVIEW', 'WAITING_FOR_WALLET', 'PENDING_CHAIN', 'BLOCKED', 'EXPIRED', 'CLOSED']),
  reviews: z.strictObject({ merchant: z.boolean(), payer: z.boolean() }),
  presence: z.strictObject({ merchant: PresenceStateSchema, payer: PresenceStateSchema.nullable() }),
  payerProgress: PayerProgressSchema.nullable(),
});

const RoomEventSchema = z.strictObject({
  schemaVersion: z.literal(ROOM_EVENT_VERSION),
  eventId: Cursor,
  sessionId: z.uuid(),
  emittedAt: z.string().max(64),
  type: z.enum(['session.created', 'session.bound', 'session.joined', 'session.reviewed', 'session.presence', 'session.expired', 'session.closed', 'payer.progress']),
  room: RoomSnapshotSchema,
});

export const RoomSyncSchema = z
  .strictObject({
    schemaVersion: z.literal(ROOM_SYNC_VERSION),
    sessionId: z.uuid(),
    cursor: Cursor,
    reset: z.boolean(),
    serverTimeMs: z.number().int().nonnegative(),
    room: RoomSnapshotSchema,
    events: z.array(RoomEventSchema).max(64),
  })
  .superRefine((sync, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (sync.room.session.id !== sync.sessionId) issue('room belongs to another session');
    let last = 0n;
    for (const event of sync.events) {
      if (event.sessionId !== sync.sessionId || event.room.session.id !== sync.sessionId) issue('event belongs to another session');
      const id = BigInt(event.eventId);
      if (id <= last) issue('event IDs must increase');
      last = id;
    }
    if (last > BigInt(sync.cursor)) issue('event beyond the cursor');
    if (sync.reset && sync.events.length > 0) issue('a reset carries no partial events');
  });

export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type RoomSync = z.infer<typeof RoomSyncSchema>;

export type RoomParse =
  | { readonly ok: true; readonly sync: RoomSync }
  | { readonly ok: false; readonly reason: 'unsupported_version' | 'invalid' };

/** Strict parse. An unknown schema version is `unsupported`, never coerced. */
export function parseRoomSync(raw: unknown): RoomParse {
  if (typeof raw === 'object' && raw !== null && 'schemaVersion' in raw) {
    const version = (raw as { schemaVersion: unknown }).schemaVersion;
    if (typeof version === 'string' && version.startsWith('taply.room-sync.') && version !== ROOM_SYNC_VERSION) {
      return { ok: false, reason: 'unsupported_version' };
    }
  }
  const parsed = RoomSyncSchema.safeParse(raw);
  return parsed.success ? { ok: true, sync: parsed.data } : { ok: false, reason: 'invalid' };
}

/* ------------------------------------------------------------------------ */
/* Applying syncs: cursor-fenced, session-scoped, account-scoped             */
/* ------------------------------------------------------------------------ */

export interface RoomScope {
  readonly sessionId: string;
  readonly accountId: string;
  /** Bumped on login, logout and account switch. */
  readonly authGeneration: number;
}

export interface RoomState {
  readonly scope: RoomScope;
  readonly cursor: string;
  readonly room: RoomSnapshot;
  readonly serverTimeMs: number;
}

export type RoomApply =
  | { readonly kind: 'applied'; readonly state: RoomState; readonly recheckChain: true }
  | {
      readonly kind: 'ignored';
      readonly state: RoomState | null;
      readonly reason: 'other_session' | 'stale_scope' | 'older_or_duplicate';
      readonly recheckChain: false;
    };

const sameScope = (a: RoomScope, b: RoomScope) =>
  a.sessionId === b.sessionId && a.accountId === b.accountId && a.authGeneration === b.authGeneration;

/**
 * Applies one validated sync (backend algorithm steps 3-5):
 *  - a response for another session, or fetched under a different account or
 *    auth generation than the current one, is discarded;
 *  - an older or equal cursor is ignored unless it is an explicit reset (a
 *    duplicate delivery changes nothing and replays no visual action);
 *  - otherwise the atomic current room replaces local state, and the caller
 *    must re-read the chain (`recheckChain`). Nothing here is payment state.
 */
export function applyRoomSync(input: {
  readonly previous: RoomState | null;
  readonly sync: RoomSync;
  /** Scope captured when the request was sent. */
  readonly requested: RoomScope;
  /** Scope now, when the response arrives. */
  readonly current: RoomScope;
}): RoomApply {
  const { previous, sync, requested, current } = input;
  if (!sameScope(requested, current)) return { kind: 'ignored', state: previous, reason: 'stale_scope', recheckChain: false };
  if (sync.sessionId !== current.sessionId) return { kind: 'ignored', state: previous, reason: 'other_session', recheckChain: false };
  const base = previous !== null && sameScope(previous.scope, current) ? previous : null;
  if (base !== null && !sync.reset && BigInt(sync.cursor) <= BigInt(base.cursor)) {
    return { kind: 'ignored', state: base, reason: 'older_or_duplicate', recheckChain: false };
  }
  return {
    kind: 'applied',
    state: { scope: current, cursor: sync.cursor, room: sync.room, serverTimeMs: sync.serverTimeMs },
    recheckChain: true,
  };
}

/* ------------------------------------------------------------------------ */
/* Presentation                                                              */
/* ------------------------------------------------------------------------ */

/** Chain-side status shown NEXT TO the room. Supplied by the caller from its own chain read. */
export type ChainSide = 'not_read' | 'open' | 'in_flight' | 'paid_per_contract' | 'verified_paid' | 'needs_attention' | 'closed';

export type RoomUnavailable =
  | 'flag_off'
  | 'backend_not_connected'
  | 'unsupported_version'
  | 'refused'
  | 'session_not_found'
  /** The contract cannot bind sessions (pilot capability sessionBinding: false). */
  | 'verification_unavailable';

export type RoomPhase =
  | 'not_bound'
  | 'waiting_for_customer'
  | 'customer_joined'
  | 'reviewing'
  | 'waiting_for_wallet'
  | 'pending_chain'
  | 'outcome_unknown'
  | 'mismatch'
  | 'expired'
  | 'closed';

export type RoomView =
  | { readonly kind: 'unavailable'; readonly reason: RoomUnavailable }
  | {
      readonly kind: 'room';
      readonly authority: 'coordination_only';
      /** There is no 'verified' member: no reviewed proof exists in this build. */
      readonly merchantIdentity: 'unverified';
      readonly phase: RoomPhase;
      /** The OTHER participant's connection, from presence leases. Advisory. */
      readonly connection: 'connected' | 'interrupted' | 'reconnected' | 'not_joined';
      readonly code: string | null;
      readonly codeMatch: 'match' | 'mismatch' | 'pending';
      readonly reviews: { readonly merchant: boolean; readonly payer: boolean };
      /** Reported by the payer's phone; the service cannot see the wallet. Never proof. */
      readonly walletAdvisory: 'awaiting_wallet' | 'submitted' | 'outcome_unknown' | 'rejected' | null;
      /** From this device's chain read, never from the room. */
      readonly chain: ChainSide;
      readonly customerMayProceed: boolean;
    };

/**
 * One view model for both phones. `chain` is passed through untouched: if the
 * room says PENDING_CHAIN but the chain is still OPEN, the chain line still
 * says open. Expiry uses the given chain-time `nowNs`, never the device clock.
 */
export function presentRoom(input: {
  readonly role: HandshakeRole;
  readonly room: RoomSnapshot;
  readonly chainTerms: IntentTerms | null;
  readonly nowNs: string;
  readonly chain: ChainSide;
}): RoomView {
  const { role, room, chainTerms, nowNs, chain } = input;
  const session: HandshakeSession = room.session;
  const local = presentHandshake({ role, session, chainTerms, nowNs });
  const other = role === 'merchant' ? room.presence.payer : room.presence.merchant;
  // Joined = the service recorded the single-use authenticated join of a payer account.
  const authenticatedPayer = session.payerAccountId !== null && room.presence.payer !== null && (session.state === 'PAIRED' || session.state === 'REVIEWED');
  const connection =
    role === 'merchant' && !authenticatedPayer
      ? 'not_joined'
      : other === null
        ? 'not_joined'
        : other === 'disconnected'
          ? 'interrupted'
          : other === 'resumed'
            ? 'reconnected'
            : 'connected';
  const progress = room.payerProgress?.phase ?? null;
  const walletAdvisory =
    progress === 'AWAITING_WALLET'
      ? 'awaiting_wallet'
      : progress === 'SUBMITTED'
        ? 'submitted'
        : progress === 'OUTCOME_UNKNOWN'
          ? 'outcome_unknown'
          : progress === 'USER_REJECTED'
            ? 'rejected'
            : null;

  const phase: RoomPhase = (() => {
    if (local.phase === 'closed' || room.phase === 'CLOSED') return 'closed';
    if (local.phase === 'expired' || room.phase === 'EXPIRED') return 'expired';
    if (local.phase === 'not_bound') return 'not_bound';
    if (local.phase === 'mismatch') return 'mismatch';
    if (room.phase === 'BLOCKED') return 'outcome_unknown';
    if (room.phase === 'PENDING_CHAIN') return 'pending_chain';
    if (room.phase === 'WAITING_FOR_WALLET' && room.reviews.merchant && room.reviews.payer) return 'waiting_for_wallet';
    if (authenticatedPayer && (room.reviews.merchant || room.reviews.payer)) return 'reviewing';
    if (authenticatedPayer) return 'customer_joined';
    return 'waiting_for_customer';
  })();

  const codeMatch = local.phase === 'mismatch' ? 'mismatch' : local.code !== null && session.comparisonCode === local.code ? 'match' : 'pending';
  return {
    kind: 'room',
    authority: 'coordination_only',
    merchantIdentity: 'unverified',
    phase,
    connection,
    code: local.code,
    codeMatch,
    reviews: { merchant: room.reviews.merchant, payer: room.reviews.payer },
    walletAdvisory,
    chain,
    customerMayProceed: local.customerMayProceed && phase !== 'mismatch' && phase !== 'expired' && phase !== 'closed',
  };
}

/* ------------------------------------------------------------------------ */
/* Adapter boundary                                                          */
/* ------------------------------------------------------------------------ */

export type RoomRead =
  | { readonly ok: true; readonly sync: RoomSync }
  | { readonly ok: false; readonly error: 'unavailable' | 'unauthenticated' | 'forbidden' | 'expired' | 'not_found' | 'unsupported_version' | 'invalid' };

export interface RoomAdapter {
  readonly version: typeof ROOM_ADAPTER_VERSION;
  readonly availability: { readonly kind: 'available' } | { readonly kind: 'unavailable'; readonly reason: 'flag_off' | 'backend_not_connected' };
  /** One read-only sync. `cursor` is the last applied room cursor for THIS session, or null. */
  sync(sessionId: string, cursor: string | null): Promise<RoomRead>;
}

function unavailableRoom(reason: 'flag_off' | 'backend_not_connected'): RoomAdapter {
  return { version: ROOM_ADAPTER_VERSION, availability: { kind: 'unavailable', reason }, sync: async () => ({ ok: false, error: 'unavailable' }) };
}

/** The only adapter this build ships: refuses every call. */
export const UNAVAILABLE_ROOM: RoomAdapter = unavailableRoom('backend_not_connected');

/** Same gate as the Handshake adapter: flag on AND a reviewed backend, or nothing. */
export function resolveRoomAdapter(flags: Readonly<Record<FeatureFlag, FlagState>>, backend: RoomAdapter | null = null): RoomAdapter {
  if (!flags.handshake.enabled) return unavailableRoom('flag_off');
  if (backend === null || backend.version !== ROOM_ADAPTER_VERSION || backend.availability.kind !== 'available') return UNAVAILABLE_ROOM;
  return backend;
}

/**
 * Read-only HTTP seam for `GET /api/v1/sessions/:id/room` (JSON polling form).
 * Exact same-origin HTTPS, `credentials: same-origin`, no-store, no redirects,
 * 5 s timeout, cursor only in the Last-Event-ID header (never in the URL).
 * NOT installed: nothing in this build constructs it for a live route.
 */
export function createRoomReader(origin: string, transport: typeof fetch): RoomAdapter {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || (typeof window !== 'undefined' && window.location.origin !== origin)) {
    throw new Error('Invalid coordination origin');
  }
  return {
    version: ROOM_ADAPTER_VERSION,
    availability: { kind: 'available' },
    async sync(sessionId, cursor) {
      if (!z.uuid().safeParse(sessionId).success || (cursor !== null && !Cursor.safeParse(cursor).success)) return { ok: false, error: 'invalid' };
      try {
        const response = await transport(`${origin}/api/v1/sessions/${sessionId}/room`, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { Accept: 'application/json', ...(cursor === null ? {} : { 'Last-Event-ID': cursor }) },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.headers.get('content-type')?.startsWith('application/json')) return { ok: false, error: 'unavailable' };
        if (response.status === 401) return { ok: false, error: 'unauthenticated' };
        if (response.status === 403) return { ok: false, error: 'forbidden' };
        if (response.status === 404) return { ok: false, error: 'not_found' };
        if (response.status === 410) return { ok: false, error: 'expired' };
        if (!response.ok) return { ok: false, error: 'unavailable' };
        const parsed = parseRoomSync(parseStrictJson(await response.text()));
        if (!parsed.ok) return { ok: false, error: parsed.reason };
        if (parsed.sync.sessionId !== sessionId) return { ok: false, error: 'invalid' };
        return { ok: true, sync: parsed.sync };
      } catch {
        return { ok: false, error: 'unavailable' };
      }
    },
  };
}
