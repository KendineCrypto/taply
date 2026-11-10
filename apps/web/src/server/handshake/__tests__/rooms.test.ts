// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRooms, RoomError } from '../rooms';
import type { RedisCommand } from '../redis';
import { hasRedis, startRedis } from './redis-fixture';

let cmd: RedisCommand;
let stop: (() => Promise<void>) | null = null;
beforeAll(async () => { if (!hasRedis) return; const r = await startRedis(); cmd = r.cmd; stop = r.stop; });
afterAll(async () => { await stop?.(); });

describe.skipIf(!hasRedis)('live handshake rooms (real Redis via REST)', () => {
  it('merchant creates, ONE customer joins with the QR token, both see each other online; payment is never in the room', async () => {
    const now = 1_800_000_000_000;
    const rooms = createRooms({ redis: cmd, now: () => now });
    const room = await rooms.create('a'.repeat(64), now + 15 * 60_000);
    expect(room.roomId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const m0 = await rooms.sync(room.roomId, 'merchant', room.merchantToken);
    expect(m0).toMatchObject({ authority: 'coordination_only', requestId: 'a'.repeat(64), merchant: { online: true }, customer: { joined: false, online: false } });
    expect(Object.keys(m0)).not.toContain('paid');
    await expect(rooms.join(room.roomId, 'wrong-token-xxxxxxxxxxxxxxxx', 'p'.repeat(43))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await rooms.join(room.roomId, room.joinToken, 'p'.repeat(43))).toEqual({ requestId: 'a'.repeat(64), rejoined: false });
    // A second phone with the same QR cannot take over; the same phone may rejoin.
    await expect(rooms.join(room.roomId, room.joinToken, 'q'.repeat(43))).rejects.toMatchObject({ code: 'ALREADY_JOINED', requestId: 'a'.repeat(64) });
    expect((await rooms.join(room.roomId, room.joinToken, 'p'.repeat(43))).rejoined).toBe(true);
    const c1 = await rooms.sync(room.roomId, 'customer', 'p'.repeat(43), 'reviewing');
    expect(c1.customer).toMatchObject({ joined: true, online: true, state: 'reviewing' });
    expect(c1.merchant.online).toBe(true);
    const m1 = await rooms.sync(room.roomId, 'merchant', room.merchantToken);
    expect(m1.events.map((e) => e.type)).toEqual(['created', 'customer_joined', 'customer_reviewing']);
    // Tokens are enforced per role.
    await expect(rooms.sync(room.roomId, 'customer', room.merchantToken)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(rooms.sync(room.roomId, 'merchant', 'p'.repeat(43))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Nothing secret is stored.
    const raw = JSON.stringify(await cmd(['KEYS', `taply:hs:{${room.roomId}}:*`])) + JSON.stringify(await cmd(['GET', `taply:hs:{${room.roomId}}:room`]));
    for (const secret of [room.merchantToken, room.joinToken, 'p'.repeat(43)]) expect(raw).not.toContain(secret);
  });

  it('disconnect → offline after 8 s; coming back is a rejoin event; paying is a hint only; expiry and close', async () => {
    let now = 1_800_000_000_000;
    const rooms = createRooms({ redis: cmd, now: () => now });
    const room = await rooms.create('b'.repeat(64), now + 60_000);
    await rooms.join(room.roomId, room.joinToken, 'c'.repeat(43));
    await rooms.sync(room.roomId, 'customer', 'c'.repeat(43));
    now += 9_000; // customer phone went away
    const m = await rooms.sync(room.roomId, 'merchant', room.merchantToken);
    expect(m.customer).toMatchObject({ joined: true, online: false });
    const back = await rooms.sync(room.roomId, 'customer', 'c'.repeat(43), 'paying');
    expect(back.customer.online).toBe(true);
    expect(back.events.map((e) => e.type).slice(-2)).toEqual(['customer_rejoined', 'customer_paying']);
    now += 60_000;
    const late = await rooms.sync(room.roomId, 'merchant', room.merchantToken);
    expect(late.expired).toBe(true);
    await expect(rooms.join(room.roomId, room.joinToken, 'z'.repeat(43))).rejects.toMatchObject({ code: 'EXPIRED' });
    await expect(rooms.close(room.roomId, 'c'.repeat(43))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await rooms.close(room.roomId, room.merchantToken);
    const closed = await rooms.sync(room.roomId, 'customer', 'c'.repeat(43));
    expect(closed.closed).toBe(true);
    expect(closed.events.at(-1)?.type).toBe('closed');
    await expect(rooms.create('c'.repeat(64), now - 1)).rejects.toBeInstanceOf(RoomError);
  });

  it('unknown rooms and the rate limiter', async () => {
    const rooms = createRooms({ redis: cmd });
    await expect(rooms.sync('x'.repeat(22), 'merchant', 'y'.repeat(43))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(rooms.join('x'.repeat(22), 'y'.repeat(32), 'z'.repeat(43))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rooms.allow('test', '203.0.113.9', 3));
    expect(results).toEqual([true, true, true, false]);
  });
});
