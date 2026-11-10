// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleCreate, handleHealth, handleRoom } from '../http';
import type { HandshakeDeps } from '../http';
import type { RedisCommand } from '../redis';
import { hasRedis, startRedis } from './redis-fixture';

let cmd: RedisCommand;
let stop: (() => Promise<void>) | null = null;
beforeAll(async () => { if (!hasRedis) return; const r = await startRedis(); cmd = r.cmd; stop = r.stop; });
afterAll(async () => { await stop?.(); });

const OPEN = 'a'.repeat(64);
const PAID = 'b'.repeat(64);
const deps = (): HandshakeDeps => ({ redis: cmd, openRequestDeadlineMs: async (id) => (id === OPEN ? Date.now() + 10 * 60_000 : null) });
const post = (path: string, body: unknown, ip = '198.51.100.7') => new Request(`https://taplyapp.xyz${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body),
});

describe.skipIf(!hasRedis)('live handshake HTTP (real Redis)', () => {
  it('health reflects configuration; no Redis means unavailable everywhere', async () => {
    expect(await (await handleHealth(deps())).json()).toEqual({ available: true });
    const none: HandshakeDeps = { redis: null, openRequestDeadlineMs: async () => null };
    expect(await (await handleHealth(none)).json()).toEqual({ available: false });
    expect((await handleCreate(post('/api/handshake/rooms', { requestId: OPEN }), none)).status).toBe(503);
  });

  it('only an OPEN on-chain request gets a room; full join → sync → close over HTTP', async () => {
    expect((await handleCreate(post('/api/handshake/rooms', { requestId: PAID }), deps())).status).toBe(409);
    expect((await handleCreate(post('/api/handshake/rooms', { requestId: 'nope' }), deps())).status).toBe(400);
    expect((await handleCreate(post('/api/handshake/rooms', { requestId: OPEN, extra: 1 }), deps())).status).toBe(400);
    const res = await handleCreate(post('/api/handshake/rooms', { requestId: OPEN }), deps());
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const room = (await res.json()) as { roomId: string; merchantToken: string; joinToken: string };
    const call = (body: unknown) => handleRoom(post(`/api/handshake/rooms/${room.roomId}`, body), room.roomId, deps());
    const participant = 'P'.repeat(43);
    expect((await call({ action: 'join', joinToken: room.joinToken, participantToken: participant })).status).toBe(200);
    const taken = await call({ action: 'join', joinToken: room.joinToken, participantToken: 'Q'.repeat(43) });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'ALREADY_JOINED', requestId: OPEN });
    const synced = await call({ action: 'sync', role: 'customer', token: participant, state: 'reviewing' });
    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({ requestId: OPEN, customer: { joined: true, state: 'reviewing' } });
    expect((await call({ action: 'sync', role: 'merchant', token: participant })).status).toBe(403);
    expect((await call({ action: 'close', token: room.merchantToken })).status).toBe(200);
    expect((await handleRoom(post('/api/handshake/rooms/bad', { action: 'close', token: room.merchantToken }), 'bad', deps())).status).toBe(404);
  });

  it('requires JSON, bounds the body and rate-limits room creation per client', async () => {
    const text = new Request('https://taplyapp.xyz/api/handshake/rooms', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect((await handleCreate(text, deps())).status).toBe(400);
    expect((await handleCreate(post('/api/handshake/rooms', { requestId: OPEN, pad: 'x'.repeat(3000) }), deps())).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await handleCreate(post('/api/handshake/rooms', { requestId: OPEN }, '203.0.113.50'), deps())).status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(30);
    expect(statuses.at(-1)).toBe(429);
  });
});
