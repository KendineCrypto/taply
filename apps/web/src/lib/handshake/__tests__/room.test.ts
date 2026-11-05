// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FLAGS, resolveFlags } from '@/lib/flags/features';
import { HandshakeSessionSchema } from '@/lib/protocol';
import type { HandshakeSession } from '@/lib/protocol';
import { DEMO_CUSTOMER, DEMO_NOW_NS, DEMO_TERMS, DEMO_TERMS_SUBSTITUTED, demoSession } from '@/lib/mock/handshake-demo';
import {
  ROOM_ADAPTER_VERSION,
  applyRoomSync,
  createRoomReader,
  parseRoomSync,
  presentRoom,
  resolveRoomAdapter,
  UNAVAILABLE_ROOM,
} from '../room';
import type { RoomAdapter, RoomScope, RoomSnapshot, RoomSync } from '../room';

/**
 * Phase 7G room boundary. SYNTHETIC sessions (lib/mock/handshake-demo.ts),
 * shaped like apps/api room responses. No network, no wallet, no chain.
 */

const SESSION = demoSession(0, false);
const SID = SESSION.id;

function snapshot(over: Partial<RoomSnapshot> & { session?: HandshakeSession } = {}): RoomSnapshot {
  return {
    schemaVersion: 'taply.room.v1',
    authority: 'coordination_only',
    session: SESSION,
    phase: 'WAITING_FOR_CUSTOMER',
    reviews: { merchant: false, payer: false },
    presence: { merchant: 'active', payer: null },
    payerProgress: null,
    ...over,
  };
}

function sync(over: Partial<RoomSync> = {}, room: RoomSnapshot = snapshot()): Record<string, unknown> {
  return { schemaVersion: 'taply.room-sync.v1', sessionId: SID, cursor: '3', reset: false, serverTimeMs: 1, room, events: [], ...over };
}

const parsed = (raw: Record<string, unknown>) => {
  const p = parseRoomSync(raw);
  if (!p.ok) throw new Error(`expected valid sync: ${p.reason}`);
  return p.sync;
};

const joined = (reviewed = false) => demoSession(reviewed ? 3 : 1, reviewed);

describe('parseRoomSync', () => {
  it('accepts a valid room-sync.v1 envelope', () => {
    expect(parseRoomSync(sync()).ok).toBe(true);
  });

  it('refuses an unknown version as unsupported, never coerced', () => {
    expect(parseRoomSync(sync({ schemaVersion: 'taply.room-sync.v2' } as never))).toEqual({ ok: false, reason: 'unsupported_version' });
  });

  it('refuses extra fields, foreign sessions, unordered events, partial resets and forged progress', () => {
    const event = (eventId: string, sessionId = SID) => ({ schemaVersion: 'taply.room-event.v1', eventId, sessionId, emittedAt: 'x', type: 'session.presence', room: snapshot() });
    const bad: Array<Record<string, unknown>> = [
      { ...sync(), paid: true },
      sync({ sessionId: '11111111-1111-4111-8111-111111111111' }),
      sync({ events: [event('2'), event('2')] } as never),
      sync({ events: [event('4')] } as never), // beyond cursor 3
      sync({ reset: true, events: [event('1')] } as never),
      sync({}, { ...snapshot(), authority: 'payment' } as never),
      sync({}, snapshot({ payerProgress: { phase: 'SUBMITTED', transactionHash: null } })),
      sync({}, snapshot({ payerProgress: { phase: 'AWAITING_WALLET', transactionHash: '9x5BWFTV7ZcFDXxHyLsdNFHD5KQdXLfwQdgs6GPdShfJ' } })),
    ];
    for (const raw of bad) expect(parseRoomSync(raw).ok).toBe(false);
  });
});

describe('applyRoomSync', () => {
  const scope: RoomScope = { sessionId: SID, accountId: 'cafe.demo.testnet', authGeneration: 1 };

  it('applies the atomic room and always asks for a chain re-read', () => {
    const r = applyRoomSync({ previous: null, sync: parsed(sync()), requested: scope, current: scope });
    expect(r).toMatchObject({ kind: 'applied', recheckChain: true });
  });

  it('ignores duplicates and older cursors, but takes an explicit reset', () => {
    const first = applyRoomSync({ previous: null, sync: parsed(sync({ cursor: '5' })), requested: scope, current: scope });
    if (first.kind !== 'applied') throw new Error('applied expected');
    for (const cursor of ['5', '4', '0']) {
      expect(applyRoomSync({ previous: first.state, sync: parsed(sync({ cursor })), requested: scope, current: scope })).toMatchObject({
        kind: 'ignored',
        reason: 'older_or_duplicate',
        recheckChain: false,
      });
    }
    // Big cursors compare as BigInt, not as strings or floats.
    const big = applyRoomSync({ previous: first.state, sync: parsed(sync({ cursor: '10000000000000000001' })), requested: scope, current: scope });
    expect(big.kind).toBe('applied');
    expect(applyRoomSync({ previous: first.state, sync: parsed(sync({ cursor: '1', reset: true })), requested: scope, current: scope }).kind).toBe('applied');
  });

  it('discards a response fetched under another account, auth generation or session', () => {
    for (const current of [
      { ...scope, accountId: 'other.testnet' },
      { ...scope, authGeneration: 2 },
      { ...scope, sessionId: '11111111-1111-4111-8111-111111111111' },
    ]) {
      const r = applyRoomSync({ previous: null, sync: parsed(sync()), requested: scope, current });
      expect(r.kind).toBe('ignored');
    }
  });
});

describe('presentRoom', () => {
  const view = (room: RoomSnapshot, role: 'merchant' | 'customer' = 'merchant', chain = 'open' as const, terms = DEMO_TERMS) =>
    presentRoom({ role, room, chainTerms: terms, nowNs: DEMO_NOW_NS, chain });

  it('waiting: no customer, no presence, even if a payer presence slot says active on an OPEN session', () => {
    const v = view(snapshot({ presence: { merchant: 'active', payer: 'active' } }));
    expect(v).toMatchObject({ kind: 'room', phase: 'waiting_for_customer', connection: 'not_joined' });
  });

  it('customer joined only with an authenticated payer recorded on a PAIRED session', () => {
    const v = view(snapshot({ session: joined(), phase: 'WAITING_FOR_REVIEW', presence: { merchant: 'active', payer: 'joined' } }));
    expect(v).toMatchObject({ phase: 'customer_joined', connection: 'connected', codeMatch: 'match' });
  });

  it('connection interrupted and reconnected follow the counterpart presence lease', () => {
    const base = { session: joined(), phase: 'WAITING_FOR_REVIEW' as const };
    expect(view(snapshot({ ...base, presence: { merchant: 'active', payer: 'disconnected' } })).kind === 'room' &&
      view(snapshot({ ...base, presence: { merchant: 'active', payer: 'disconnected' } }))).toMatchObject({ connection: 'interrupted' });
    expect(view(snapshot({ ...base, presence: { merchant: 'active', payer: 'resumed' } }))).toMatchObject({ connection: 'reconnected' });
    expect(view(snapshot({ ...base, presence: { merchant: 'disconnected', payer: 'active' } }), 'customer')).toMatchObject({ connection: 'interrupted' });
  });

  it('substituted terms on one phone: mismatch, codes differ, the customer may not proceed', () => {
    const room = snapshot({ session: joined(true), phase: 'WAITING_FOR_WALLET', reviews: { merchant: true, payer: true }, presence: { merchant: 'active', payer: 'active' } });
    const v = view(room, 'customer', 'open', DEMO_TERMS_SUBSTITUTED);
    expect(v).toMatchObject({ phase: 'mismatch', codeMatch: 'mismatch', customerMayProceed: false });
  });

  it('a payer "submitted" hint is advisory: the chain line still says open, and nothing says paid', () => {
    const room = snapshot({
      session: joined(true),
      phase: 'PENDING_CHAIN',
      reviews: { merchant: true, payer: true },
      presence: { merchant: 'active', payer: 'active' },
      payerProgress: { phase: 'SUBMITTED', transactionHash: '9x5BWFTV7ZcFDXxHyLsdNFHD5KQdXLfwQdgs6GPdShfJ' },
    });
    const v = view(room);
    expect(v).toMatchObject({ phase: 'pending_chain', walletAdvisory: 'submitted', chain: 'open' });
    expect(JSON.stringify(v).toLowerCase()).not.toContain('paid');
  });

  it('OUTCOME_UNKNOWN blocks instead of inviting a second payment', () => {
    const room = snapshot({ session: joined(true), phase: 'BLOCKED', reviews: { merchant: true, payer: true }, payerProgress: { phase: 'OUTCOME_UNKNOWN', transactionHash: null } });
    expect(view(room)).toMatchObject({ phase: 'outcome_unknown', walletAdvisory: 'outcome_unknown' });
  });

  it('expiry is judged on chain time, and the server EXPIRED state is respected', () => {
    const late = (BigInt(SESSION.expiresAtNs) + 1n).toString();
    expect(presentRoom({ role: 'customer', room: snapshot(), chainTerms: DEMO_TERMS, nowNs: late, chain: 'open' })).toMatchObject({ phase: 'expired', customerMayProceed: false });
    const expired = HandshakeSessionSchema.parse({ ...SESSION, state: 'EXPIRED' });
    expect(view(snapshot({ session: expired, phase: 'EXPIRED' }))).toMatchObject({ phase: 'expired' });
  });

  it('merchant identity is never verified, in any state', () => {
    const rooms = [
      snapshot(),
      snapshot({ session: joined(), phase: 'WAITING_FOR_REVIEW', presence: { merchant: 'active', payer: 'active' } }),
      snapshot({ session: joined(true), phase: 'WAITING_FOR_WALLET', reviews: { merchant: true, payer: true } }),
    ];
    for (const room of rooms) for (const role of ['merchant', 'customer'] as const) {
      const v = view(room, role);
      expect(v.kind === 'room' && v.merchantIdentity).toBe('unverified');
    }
  });

  it('chain status is passed through, never upgraded by the room', () => {
    const room = snapshot({ session: joined(true), phase: 'WAITING_FOR_WALLET', reviews: { merchant: true, payer: true } });
    for (const chain of ['not_read', 'open', 'in_flight', 'paid_per_contract'] as const) {
      expect(presentRoom({ role: 'merchant', room, chainTerms: DEMO_TERMS, nowNs: DEMO_NOW_NS, chain })).toMatchObject({ chain });
    }
    expect(DEMO_CUSTOMER).toContain('demo.testnet');
  });
});

describe('room adapter gating', () => {
  const backend: RoomAdapter = { version: ROOM_ADAPTER_VERSION, availability: { kind: 'available' }, sync: async () => ({ ok: false, error: 'unavailable' }) };

  it('this build: Handshake is off and no backend is wired, so the room is unavailable', () => {
    expect(FLAGS.handshake.enabled).toBe(false);
    expect(resolveRoomAdapter(FLAGS).availability).toEqual({ kind: 'unavailable', reason: 'flag_off' });
    expect(resolveRoomAdapter(FLAGS, backend).availability.kind).toBe('unavailable');
  });

  it('flag on without a reviewed backend, or with a wrong adapter version, is still unavailable', () => {
    const on = resolveFlags({ NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: 'on' });
    expect(resolveRoomAdapter(on)).toBe(UNAVAILABLE_ROOM);
    expect(resolveRoomAdapter(on, { ...backend, version: 'taply.room-adapter.v0' as never })).toBe(UNAVAILABLE_ROOM);
    expect(resolveRoomAdapter(on, backend)).toBe(backend);
  });
});

describe('createRoomReader (not installed in any route)', () => {
  const origin = 'https://pilot.taply.example';
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('refuses non-HTTPS or path-carrying origins', () => {
    expect(() => createRoomReader('http://pilot.taply.example', fetch)).toThrow();
    expect(() => createRoomReader('https://pilot.taply.example/x', fetch)).toThrow();
  });

  it('sends the cursor only in Last-Event-ID and never in the URL; reads strictly', async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const reader = createRoomReader(origin, async (url, init) => {
      seen.push({ url: String(url), init });
      return json(200, sync({ cursor: '7' }));
    });
    // jsdom's own origin differs: construct with a matching window origin.
    const result = await reader.sync(SID, '6');
    expect(result.ok).toBe(true);
    expect(seen[0]?.url).toBe(`${origin}/api/v1/sessions/${SID}/room`);
    expect(seen[0]?.url).not.toContain('6');
    expect((seen[0]?.init?.headers as Record<string, string>)['Last-Event-ID']).toBe('6');
    expect(seen[0]?.init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  });

  it('maps auth errors, versions and foreign sessions without ever succeeding', async () => {
    const answers: Array<[Response, string]> = [
      [json(401, {}), 'unauthenticated'],
      [json(403, {}), 'forbidden'],
      [json(410, {}), 'expired'],
      [json(200, sync({ schemaVersion: 'taply.room-sync.v9' } as never)), 'unsupported_version'],
      [json(200, { ...sync(), extra: 1 }), 'invalid'],
      [new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'unavailable'],
    ];
    for (const [response, error] of answers) {
      const reader = createRoomReader(origin, async () => response);
      expect(await reader.sync(SID, null)).toEqual({ ok: false, error });
    }
    const reader = createRoomReader(origin, async () => json(200, sync()));
    expect(await reader.sync('not-a-uuid', null)).toEqual({ ok: false, error: 'invalid' });
  });
});
