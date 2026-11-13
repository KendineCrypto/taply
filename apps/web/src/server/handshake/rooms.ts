import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RedisCommand } from './redis';

/**
 * Live Handshake rooms (owner request 2026-11-10), coordination ONLY.
 *
 * A room links two phones to ONE existing on-chain payment request. It carries
 * presence ("online", "reviewing", "paying") and a short event log. It can never
 * change the request's terms (they are immutable on chain and each phone reads
 * them itself) and it can never say "paid": every phone reads payment status from
 * the chain. Nothing secret is stored: tokens are kept as SHA-256 hashes.
 *
 * Keys per room (all expire shortly after the request's funding deadline):
 *   room   {requestId, createdAtMs, expiresAtMs, joinHash}   immutable
 *   tm     merchant token hash
 *   tc     customer participant hash (single claim via SET NX)
 *   pm/pc  presence "lastSeenMs|state"
 *   ev/seq event log (last 20) and its counter
 *   closed merchant ended the session
 */

export const ONLINE_MS = 8_000;
const GRACE_MS = 10 * 60_000;
const MAX_ROOM_MS = 2 * 60 * 60_000;
const EVENTS_KEPT = 20;
export const ROOM_ID = /^[A-Za-z0-9_-]{22}$/;
export const TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
export const PRESENCE_STATES = ['viewing', 'reviewing', 'paying'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];
export type Role = 'merchant' | 'customer';

export class RoomError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'EXPIRED' | 'CLOSED' | 'ALREADY_JOINED' | 'UNAVAILABLE', readonly requestId?: string) {
    super(`handshake:${code}`);
    this.name = 'RoomError';
  }
}

export interface RoomEvent {
  readonly seq: number;
  readonly type: 'created' | 'customer_joined' | 'customer_rejoined' | 'merchant_rejoined' | 'customer_reviewing' | 'customer_paying' | 'closed';
  readonly atMs: number;
}
export interface PresenceView {
  readonly online: boolean;
  readonly lastSeenMs: number | null;
  readonly state: PresenceState | null;
}
export interface RoomSnapshot {
  readonly schema: 'taply.live-room.v1';
  readonly authority: 'coordination_only';
  readonly roomId: string;
  readonly requestId: string;
  readonly role: Role;
  readonly serverTimeMs: number;
  readonly expiresAtMs: number;
  readonly expired: boolean;
  readonly closed: boolean;
  readonly merchant: PresenceView;
  readonly customer: PresenceView & { readonly joined: boolean };
  readonly events: readonly RoomEvent[];
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const hash = (token: string) => createHash('sha256').update(`taply.handshake.v1:${token}`).digest('hex');
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
/** Default namespace = the Testnet keys as they always were. Mainnet passes its own. */
export const DEFAULT_ROOM_NAMESPACE = 'taply:hs';
const keys = (roomId: string, ns: string = DEFAULT_ROOM_NAMESPACE) => {
  const k = (s: string) => `${ns}:{${roomId}}:${s}`;
  return { room: k('room'), tm: k('tm'), tc: k('tc'), pm: k('pm'), pc: k('pc'), ev: k('ev'), seq: k('seq'), closed: k('closed') };
};
interface StoredRoom { requestId: string; createdAtMs: number; expiresAtMs: number; joinHash: string }
function parseRoom(raw: unknown): StoredRoom {
  if (typeof raw !== 'string') throw new RoomError('NOT_FOUND');
  try {
    const r = JSON.parse(raw) as StoredRoom;
    if (typeof r.requestId !== 'string' || typeof r.expiresAtMs !== 'number' || typeof r.joinHash !== 'string') throw new Error();
    return r;
  } catch {
    throw new RoomError('UNAVAILABLE');
  }
}
function parsePresence(raw: unknown, now: number): PresenceView {
  if (typeof raw !== 'string' || raw === '') return { online: false, lastSeenMs: null, state: null };
  const [seen, state] = raw.split('|');
  const lastSeenMs = Number.parseInt(seen ?? '', 10);
  if (!Number.isFinite(lastSeenMs)) return { online: false, lastSeenMs: null, state: null };
  const known = (PRESENCE_STATES as readonly string[]).includes(state ?? '') ? (state as PresenceState) : null;
  return { online: now - lastSeenMs <= ONLINE_MS, lastSeenMs, state: known };
}
function parseEvents(raw: unknown): RoomEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    try {
      const e = JSON.parse(String(item)) as RoomEvent;
      return typeof e.seq === 'number' && typeof e.type === 'string' && typeof e.atMs === 'number' ? [e] : [];
    } catch {
      return [];
    }
  });
}

/** Presence write + token check + read, atomically, in ONE Redis call. */
const SYNC = `local room = redis.call('GET', KEYS[1])
if not room then return {'NOT_FOUND'} end
local want = redis.call('GET', ARGV[1] == 'm' and KEYS[2] or KEYS[3])
if (not want) or want ~= ARGV[2] then return {'FORBIDDEN'} end
local pkey = ARGV[1] == 'm' and KEYS[4] or KEYS[5]
local prev = redis.call('GET', pkey) or ''
if redis.call('GET', KEYS[7]) then
  return {'OK', room, redis.call('GET', KEYS[4]) or '', redis.call('GET', KEYS[5]) or '', prev, redis.call('LRANGE', KEYS[6], 0, -1), '1', redis.call('EXISTS', KEYS[3])}
end
redis.call('SET', pkey, ARGV[3] .. '|' .. ARGV[4], 'PX', ARGV[5])
return {'OK', room, redis.call('GET', KEYS[4]) or '', redis.call('GET', KEYS[5]) or '', prev, redis.call('LRANGE', KEYS[6], 0, -1), '0', redis.call('EXISTS', KEYS[3])}`;

export function createRooms(input: { redis: RedisCommand; now?: () => number; random?: (n: number) => Uint8Array; namespace?: string }) {
  const cmd = input.redis;
  const ns = input.namespace ?? DEFAULT_ROOM_NAMESPACE;
  if (!/^[a-z0-9:]{1,40}$/.test(ns)) throw new Error('INVALID_ROOM_NAMESPACE');
  const now = input.now ?? Date.now;
  const random = input.random ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const ttlFor = (expiresAtMs: number) => Math.max(1_000, Math.min(expiresAtMs + GRACE_MS, now() + MAX_ROOM_MS + GRACE_MS) - now());
  const event = async (roomId: string, type: RoomEvent['type'], ttlMs: number) => {
    const k = keys(roomId, ns);
    const seq = Number.parseInt(String(await cmd(['INCR', k.seq])), 10);
    await cmd(['RPUSH', k.ev, JSON.stringify({ seq, type, atMs: now() })]);
    await cmd(['LTRIM', k.ev, -EVENTS_KEPT, -1]);
    await cmd(['PEXPIRE', k.ev, ttlMs]);
    await cmd(['PEXPIRE', k.seq, ttlMs]);
  };

  return {
    /** Starts a room for an OPEN on-chain request (the caller verified it on chain). */
    async create(requestId: string, requestExpiresAtMs: number) {
      if (!(requestExpiresAtMs > now())) throw new RoomError('EXPIRED');
      const roomId = b64url(random(16));
      const merchantToken = b64url(random(32));
      const joinToken = b64url(random(24));
      const expiresAtMs = Math.min(requestExpiresAtMs, now() + MAX_ROOM_MS);
      const ttl = ttlFor(expiresAtMs);
      const k = keys(roomId, ns);
      const stored: StoredRoom = { requestId, createdAtMs: now(), expiresAtMs, joinHash: hash(joinToken) };
      if ((await cmd(['SET', k.room, JSON.stringify(stored), 'NX', 'PX', ttl])) !== 'OK') throw new RoomError('UNAVAILABLE');
      await cmd(['SET', k.tm, hash(merchantToken), 'PX', ttl]);
      await event(roomId, 'created', ttl);
      return { roomId, merchantToken, joinToken, requestId, expiresAtMs };
    },

    /** The first device presenting the QR's join token becomes THE customer; the same device may rejoin. */
    async join(roomId: string, joinToken: string, participantToken: string) {
      const k = keys(roomId, ns);
      const room = parseRoom(await cmd(['GET', k.room]));
      if (!sameHash(hash(joinToken), room.joinHash)) throw new RoomError('FORBIDDEN');
      if ((await cmd(['GET', k.closed])) !== null) throw new RoomError('CLOSED', room.requestId);
      if (now() >= room.expiresAtMs) throw new RoomError('EXPIRED', room.requestId);
      const ttl = ttlFor(room.expiresAtMs);
      const claimed = await cmd(['SET', k.tc, hash(participantToken), 'NX', 'PX', ttl]);
      if (claimed === 'OK') {
        await event(roomId, 'customer_joined', ttl);
        return { requestId: room.requestId, rejoined: false };
      }
      const holder = await cmd(['GET', k.tc]);
      if (typeof holder === 'string' && sameHash(holder, hash(participantToken))) return { requestId: room.requestId, rejoined: true };
      throw new RoomError('ALREADY_JOINED', room.requestId);
    },

    /** "I am here" + current room, every ~2 s from each phone. */
    async sync(roomId: string, role: Role, token: string, state: PresenceState = 'viewing'): Promise<RoomSnapshot> {
      const k = keys(roomId, ns);
      const t = now();
      const result = await cmd(['EVAL', SYNC, 7, k.room, k.tm, k.tc, k.pm, k.pc, k.ev, k.closed,
        role === 'merchant' ? 'm' : 'c', hash(token), t, role === 'merchant' ? 'viewing' : state, 15 * 60_000]);
      if (!Array.isArray(result)) throw new RoomError('UNAVAILABLE');
      if (result[0] === 'NOT_FOUND') throw new RoomError('NOT_FOUND');
      if (result[0] === 'FORBIDDEN') throw new RoomError('FORBIDDEN');
      const room = parseRoom(result[1]);
      const closed = result[6] === '1';
      const prev = parsePresence(result[4], t);
      const ttl = ttlFor(room.expiresAtMs);
      // Transitions become events (the only writes besides presence).
      if (!closed) {
        if (prev.lastSeenMs !== null && !prev.online) await event(roomId, role === 'merchant' ? 'merchant_rejoined' : 'customer_rejoined', ttl);
        if (role === 'customer' && state !== prev.state && state !== 'viewing') await event(roomId, state === 'paying' ? 'customer_paying' : 'customer_reviewing', ttl);
      }
      const events = prev.lastSeenMs !== null && !prev.online || (role === 'customer' && state !== prev.state && state !== 'viewing')
        ? parseEvents(await cmd(['LRANGE', k.ev, 0, -1]))
        : parseEvents(result[5]);
      return {
        schema: 'taply.live-room.v1',
        authority: 'coordination_only',
        roomId,
        requestId: room.requestId,
        role,
        serverTimeMs: t,
        expiresAtMs: room.expiresAtMs,
        expired: t >= room.expiresAtMs,
        closed,
        merchant: parsePresence(result[2], t),
        customer: { ...parsePresence(result[3], t), joined: String(result[7]) === '1' },
        events,
      };
    },

    async close(roomId: string, merchantToken: string) {
      const k = keys(roomId, ns);
      const room = parseRoom(await cmd(['GET', k.room]));
      const holder = await cmd(['GET', k.tm]);
      if (typeof holder !== 'string' || !sameHash(holder, hash(merchantToken))) throw new RoomError('FORBIDDEN');
      const ttl = ttlFor(room.expiresAtMs);
      if ((await cmd(['SET', k.closed, '1', 'NX', 'PX', ttl])) === 'OK') await event(roomId, 'closed', ttl);
    },

    /** Fixed-window limiter; true = allowed. */
    async allow(bucket: string, who: string, max: number, windowMs = 60_000) {
      const key = `${ns}:rl:${bucket}:${createHash('sha256').update(who).digest('hex').slice(0, 24)}:${Math.floor(now() / windowMs)}`;
      const count = Number.parseInt(String(await cmd(['INCR', key])), 10);
      if (count === 1) await cmd(['PEXPIRE', key, windowMs + 5_000]);
      return count <= max;
    },
  };
}
export type Rooms = ReturnType<typeof createRooms>;
