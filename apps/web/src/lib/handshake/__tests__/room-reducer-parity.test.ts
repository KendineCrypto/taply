// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRoomCatchUp } from '@taply/near-client';
import type { RoomClientState } from '@taply/near-client';
import { DEMO_CUSTOMER, DEMO_MERCHANT, demoSession } from '@/lib/mock/handshake-demo';
import { applyRoomSync } from '../room';
import type { RoomApply, RoomScope, RoomSnapshot, RoomState } from '../room';

/**
 * Phase 7H regression: the frontend room reducer must never be laxer than the
 * core `applyRoomCatchUp`. Every row of the Phase 7G divergence table
 * (docs/PHASE_7G_INTEGRATION_REPORT.md, finding 2) is pinned here, plus a
 * seeded differential fuzz against the core reducer itself. SYNTHETIC rooms
 * only (lib/mock/handshake-demo.ts); no network, wallet or chain.
 */

const SESSION = demoSession(0, false);
const SID = SESSION.id;
const OTHER_SID = '11111111-1111-4111-8111-111111111111';
const AT = '2026-11-06T10:00:00Z';
const MERCHANT: RoomScope = { sessionId: SID, accountId: DEMO_MERCHANT, authGeneration: 1 };

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
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
const ROOM_A = snapshot();
const ROOM_B = snapshot({ presence: { merchant: 'disconnected', payer: null } });
const ROOM_C = snapshot({ presence: { merchant: 'resumed', payer: null } });

const event = (eventId: string, room: RoomSnapshot, over: Record<string, unknown> = {}) => ({
  schemaVersion: 'taply.room-event.v1',
  eventId,
  sessionId: SID,
  emittedAt: AT,
  type: 'session.presence',
  room,
  ...over,
});

function body(over: Record<string, unknown> = {}, room: RoomSnapshot = ROOM_A): Record<string, unknown> {
  return { schemaVersion: 'taply.room-sync.v1', sessionId: SID, cursor: '5', reset: false, serverTimeMs: 1, room, events: [], ...over };
}

const apply = (previous: RoomState | null, untrusted: unknown, scope: RoomScope = MERCHANT, requested: RoomScope = scope): RoomApply =>
  applyRoomSync({ previous, untrusted, requested, current: scope });

/** A merchant client that has applied cursor 5 with ROOM_A. */
function at5(): RoomState {
  const r = apply(null, body());
  if (r.kind !== 'applied') throw new Error(`setup failed: ${JSON.stringify(r)}`);
  return r.state;
}

describe('Phase 7G divergence table: every laxer row is now refused', () => {
  it('event gap after the client cursor -> refresh_required, state unchanged, refetch without cursor', () => {
    const prior = at5();
    const r = apply(prior, body({ cursor: '8', events: [event('7', ROOM_B), event('8', ROOM_B)] }, ROOM_B));
    expect(r).toMatchObject({ kind: 'refused', reason: 'refresh_required', recheckChain: false, refetchWithoutCursor: true });
    expect(r.state).toBe(prior);
  });

  it('equal cursor carrying a different room -> cursor_conflict', () => {
    const prior = at5();
    const r = apply(prior, body({ cursor: '5' }, ROOM_B));
    expect(r).toMatchObject({ kind: 'refused', reason: 'cursor_conflict', refetchWithoutCursor: true });
    expect(r.state).toBe(prior);
  });

  it('last event room differs from the snapshot -> cursor_conflict', () => {
    const r = apply(at5(), body({ cursor: '6', events: [event('6', ROOM_C)] }, ROOM_B));
    expect(r).toMatchObject({ kind: 'refused', reason: 'cursor_conflict' });
  });

  it('non-ISO emittedAt -> invalid', () => {
    for (const emittedAt of ['x', '06/11/2026', '2026-11-06', '']) {
      expect(apply(at5(), body({ cursor: '6', events: [event('6', ROOM_B, { emittedAt })] }, ROOM_B))).toMatchObject({ kind: 'refused', reason: 'invalid' });
    }
  });

  it('17+ digit cursors -> invalid (core allows at most 16 digits)', () => {
    for (const cursor of ['10000000000000000', '99999999999999999999', '012']) {
      expect(apply(null, body({ cursor }))).toMatchObject({ kind: 'refused', reason: 'invalid' });
    }
    expect(apply(null, body({ cursor: '9999999999999999' })).kind).toBe('applied');
  });

  it('an account that is not in the room -> session_mismatch, even on the first sync', () => {
    const stranger: RoomScope = { ...MERCHANT, accountId: 'stranger.testnet' };
    expect(apply(null, body(), stranger)).toMatchObject({ kind: 'refused', reason: 'session_mismatch', refetchWithoutCursor: false });
    // The payer is not in an unjoined session either.
    expect(apply(null, body(), { ...MERCHANT, accountId: DEMO_CUSTOMER })).toMatchObject({ kind: 'refused', reason: 'session_mismatch' });
    // Once joined, the payer may read it.
    const joined = snapshot({ session: demoSession(1, false), phase: 'WAITING_FOR_REVIEW', presence: { merchant: 'active', payer: 'joined' } });
    expect(apply(null, body({}, joined), { ...MERCHANT, accountId: DEMO_CUSTOMER }).kind).toBe('applied');
  });

  it('forged payment fields anywhere -> invalid', () => {
    const forged: unknown[] = [
      { ...body(), paid: true },
      body({}, { ...ROOM_A, status: 'FINAL_PAID' } as never),
      body({}, { ...ROOM_A, authority: 'payment' } as never),
      body({}, { ...ROOM_A, payerProgress: { phase: 'PAID', transactionHash: null } } as never),
      body({ cursor: '6', events: [{ ...event('6', ROOM_A), verified: true }] }),
    ];
    for (const raw of forged) expect(apply(null, raw)).toMatchObject({ kind: 'refused', reason: 'invalid' });
  });
});

describe('further adversarial inputs', () => {
  it('non-contiguous, zero, or short-of-cursor event runs -> refused, state unchanged', () => {
    const prior = at5();
    const cases: Array<[Record<string, unknown>, string]> = [
      [body({ cursor: '8', events: [event('6', ROOM_B), event('8', ROOM_B)] }, ROOM_B), 'cursor_invalid'],
      [body({ cursor: '7', events: [event('6', ROOM_B)] }, ROOM_B), 'cursor_invalid'],
      [body({ cursor: '0', events: [event('0', ROOM_B)] }, ROOM_B), 'invalid'], // the frontend parse catches it before the core
      [body({ cursor: '6', events: [event('6', ROOM_B), event('6', ROOM_B)] }, ROOM_B), 'invalid'],
      [body({ cursor: '6', events: [event('7', ROOM_B)] }, ROOM_B), 'invalid'],
    ];
    for (const [raw, reason] of cases) {
      const r = apply(prior, raw);
      expect(r, JSON.stringify(raw['events'])).toMatchObject({ kind: 'refused', reason });
      expect(r.state).toBe(prior);
    }
  });

  it('events and rooms from another session are refused', () => {
    const foreign = { ...ROOM_A, session: { ...SESSION, id: OTHER_SID } };
    expect(apply(null, body({ sessionId: OTHER_SID }, foreign))).toMatchObject({ kind: 'refused' });
    expect(apply(null, body({}, foreign))).toMatchObject({ kind: 'refused' });
    expect(apply(at5(), body({ cursor: '6', events: [event('6', ROOM_B, { sessionId: OTHER_SID })] }, ROOM_B))).toMatchObject({ kind: 'refused' });
  });

  it('inconsistent payer progress is refused (frontend rule kept on top of the core)', () => {
    const hash = '9x5BWFTV7ZcFDXxHyLsdNFHD5KQdXLfwQdgs6GPdShfJ';
    expect(apply(null, body({}, snapshot({ payerProgress: { phase: 'SUBMITTED', transactionHash: null } })))).toMatchObject({ kind: 'refused', reason: 'invalid' });
    expect(apply(null, body({}, snapshot({ payerProgress: { phase: 'AWAITING_WALLET', transactionHash: hash } })))).toMatchObject({ kind: 'refused', reason: 'invalid' });
    // Also inside an event's room, not only the top-level snapshot.
    const bad = snapshot({ payerProgress: { phase: 'USER_REJECTED', transactionHash: hash } });
    expect(apply(at5(), body({ cursor: '6', events: [event('6', bad)] }, bad))).toMatchObject({ kind: 'refused', reason: 'invalid' });
    // The core alone would accept these: the frontend is stricter, never laxer.
    expect(() => applyRoomCatchUp(null, body({}, snapshot({ payerProgress: { phase: 'SUBMITTED', transactionHash: null } })), { ...MERCHANT }, 1)).not.toThrow();
  });

  it('unknown versions are unsupported; non-objects are invalid; nothing throws', () => {
    expect(apply(null, body({ schemaVersion: 'taply.room-sync.v2' }))).toMatchObject({ kind: 'refused', reason: 'unsupported_version' });
    for (const raw of [null, undefined, 1, 'x', [], {}, { __proto__: { schemaVersion: 'taply.room-sync.v1' } }]) {
      expect(() => apply(null, raw)).not.toThrow();
      expect(apply(null, raw).kind).toBe('refused');
    }
  });

  it('a contiguous run from cursor+1 applies, compares cursors numerically, and asks for a chain re-read', () => {
    const nine = apply(null, body({ cursor: '9' }));
    if (nine.kind !== 'applied') throw new Error('setup');
    // '10' < '9' as strings; BigInt order must win.
    const ten = apply(nine.state, body({ cursor: '10', events: [event('10', ROOM_B)] }, ROOM_B));
    expect(ten).toMatchObject({ kind: 'applied', recheckChain: true, state: { cursor: '10', room: ROOM_B } });
  });

  it('a duplicate delivery is ignored and returns the very same state object (no visual replay)', () => {
    const prior = at5();
    const again = apply(prior, body());
    expect(again).toMatchObject({ kind: 'ignored', reason: 'older_or_duplicate', recheckChain: false });
    expect(again.state).toBe(prior);
  });

  it('account switch / logout: an in-flight response under the old generation is dropped unparsed', () => {
    const prior = at5();
    const now: RoomScope = { ...MERCHANT, authGeneration: 2 };
    const late = apply(prior, body({ cursor: '6', events: [event('6', ROOM_B)] }, ROOM_B), now, MERCHANT);
    expect(late).toMatchObject({ kind: 'ignored', reason: 'stale_scope' });
    // The old account's state is not carried into the new generation.
    expect(late.state).toBeNull();
  });

  it('a state from another scope is never used as the base (fresh start, gap rules restart)', () => {
    const prior = at5();
    const other: RoomScope = { ...MERCHANT, authGeneration: 3 };
    const r = apply(prior, body({ cursor: '2' }), other);
    expect(r).toMatchObject({ kind: 'applied', state: { authGeneration: 3, cursor: '2' } });
  });

  it('applied state carries only scope, cursor and room: no payment, receipt or wallet field', () => {
    const r = apply(null, body());
    expect(r.kind).toBe('applied');
    expect(Object.keys(r.state ?? {}).sort()).toEqual(['accountId', 'authGeneration', 'cursor', 'room', 'sessionId']);
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/paid|verified|receipt|payout/);
  });
});

/* ------------------------------------------------------------------------ */
/* Differential fuzz: frontend vs the core reducer, seeded and reproducible   */
/* ------------------------------------------------------------------------ */

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('differential: never laxer than applyRoomCatchUp', () => {
  const rooms = [ROOM_A, ROOM_B, ROOM_C];
  const accounts = [DEMO_MERCHANT, DEMO_MERCHANT, DEMO_MERCHANT, 'stranger.testnet'];

  it('2,000 seeded mutations: applied => core applied the identical state; core refused => frontend refused', () => {
    const rnd = lcg(0x7a91);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    let applied = 0;
    let refused = 0;
    let ignored = 0;
    for (let i = 0; i < 2000; i += 1) {
      const scope: RoomScope = { sessionId: SID, accountId: pick(accounts), authGeneration: 1 };
      const priorCursor = Math.floor(rnd() * 6);
      const prior: RoomState | null = rnd() < 0.3 ? null : { ...scope, cursor: String(priorCursor), room: pick(rooms) };
      const cursor = Math.max(0, priorCursor + Math.floor(rnd() * 5) - 1);
      const room = pick(rooms);
      const events: Array<Record<string, unknown>> = [];
      const from = rnd() < 0.7 ? priorCursor + 1 : priorCursor + 2;
      for (let id = from; id <= cursor && events.length < 4; id += rnd() < 0.9 ? 1 : 2) events.push(event(String(id), id === cursor ? room : pick(rooms)));
      const raw: Record<string, unknown> = body({ cursor: String(cursor), reset: rnd() < 0.15, events }, room);
      const m = rnd();
      if (m < 0.04) raw['extra'] = true;
      else if (m < 0.08 && events.length > 0) events[0] = { ...events[0], emittedAt: 'yesterday' };
      else if (m < 0.1) raw['cursor'] = '1'.repeat(17);
      else if (m < 0.12) raw['serverTimeMs'] = -1;

      const ours = apply(prior, raw, scope);
      let core: RoomClientState | null | 'threw';
      try {
        core = applyRoomCatchUp(prior === null ? null : { ...prior }, raw, { ...scope }, scope.authGeneration);
      } catch {
        core = 'threw';
      }
      const ctx = JSON.stringify({ i, prior, raw: { ...raw, room: '…' } });
      if (ours.kind === 'applied') {
        applied += 1;
        expect(core, ctx).not.toBe('threw');
        expect(core, ctx).toEqual(ours.state);
        expect(prior === null || (core !== 'threw' && core !== null && core.cursor !== prior.cursor), ctx).toBe(true);
      } else {
        if (ours.kind === 'refused') refused += 1;
        else ignored += 1;
        expect(ours.state, ctx).toBe(prior);
      }
      if (core === 'threw') expect(ours.kind, ctx).toBe('refused');
    }
    // The corpus exercises every branch, not just one.
    expect(applied).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(50);
    expect(ignored).toBeGreaterThan(20);
  });
});

/* ------------------------------------------------------------------------ */
/* Live Handshake stays disabled                                              */
/* ------------------------------------------------------------------------ */

describe('no live route wires the room', () => {
  const SRC = resolve(__dirname, '../../..');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  const files = sources(SRC).map((path) => ({ path: relative(SRC, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));

  it('room.ts has no reducer of its own: it delegates to applyRoomCatchUp', () => {
    const room = files.find((f) => f.path === 'lib/handshake/room.ts');
    expect(room?.text).toMatch(/applyRoomCatchUp\(prior, untrusted, scope, requested\.authGeneration\)/);
  });

  it('applyRoomSync, createRoomReader and resolveRoomAdapter are used only inside lib/handshake', () => {
    const offenders = files
      .filter((f) => !f.path.startsWith('lib/handshake/') && /\b(applyRoomSync|createRoomReader|resolveRoomAdapter|applyRoomCatchUp)\b/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
