import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DurableStore, SqliteSessionPersistence } from '../src/storage.mts';
import { SessionEngine } from '../src/sessions.mts';
import { roomFixture } from './room-fixture.mts';

const CONNECTION = '11111111-1111-4111-8111-111111111111';

test('reopen preserves room IDs/order, consumed joins, progress idempotency and connection fencing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taply-room-reopen-')), path = join(dir, 'room.db'), key = randomBytes(32);
  let store = new SqliteSessionPersistence(path, key, true);
  try {
    const f = await roomFixture(store); await f.ready();
    const input = { expectedCursor: (await f.sync()).cursor, phase: 'AWAITING_WALLET', transactionHash: null, termsHash: f.record.termsHash };
    const progress = await f.engine.progress('payer-token', f.id, 'persist_progress_0001', input);
    const active = await f.engine.roomPresence('payer-token', f.id, { connectionId: CONNECTION, sequence: '4', state: 'active' });
    store.close(); store = new SqliteSessionPersistence(path, key);
    const engine = new SessionEngine(store, f.deps);
    assert.deepEqual(await engine.sync('payer-token', f.id), active);
    assert.deepEqual(await engine.progress('payer-token', f.id, 'persist_progress_0001', input), progress);
    await assert.rejects(engine.join('payer-token', f.id, 'persist_join_again', { joinToken: f.created.joinToken }), /JOIN_TOKEN_USED/);
    f.advance(30000);
    const expiredLease = await engine.sync('payer-token', f.id);
    assert.equal(expiredLease.room.presence.payer, 'disconnected');
    assert.ok(BigInt(expiredLease.cursor) > BigInt(active.cursor));
    assert.equal((await engine.roomPresence('payer-token', f.id, { connectionId: CONNECTION, sequence: '4', state: 'active' })).room.presence.payer, 'disconnected');
    const resumed = await engine.roomPresence('payer-token', f.id, { connectionId: CONNECTION, sequence: '5', state: 'active' });
    assert.equal(resumed.room.presence.payer, 'resumed');
    assert.ok(BigInt(resumed.cursor) > BigInt(expiredLease.cursor));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('two persisted engines serialize competing progress at one room cursor without lost updates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taply-room-race-')), path = join(dir, 'room.db'), key = randomBytes(32);
  const a = new SqliteSessionPersistence(path, key, true), b = new SqliteSessionPersistence(path, key);
  try {
    const f = await roomFixture(a); await f.ready();
    const other = new SessionEngine(b, f.deps), before = await f.sync();
    const input = { expectedCursor: before.cursor, phase: 'AWAITING_WALLET', transactionHash: null, termsHash: f.record.termsHash };
    const results = await Promise.allSettled([
      f.engine.progress('payer-token', f.id, 'competing_progress_1', input),
      other.progress('payer-token', f.id, 'competing_progress_2', input),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const failed = results.find(r => r.status === 'rejected');
    assert.ok(failed?.status === 'rejected' && /IDEMPOTENCY_CONFLICT/.test(String(failed.reason)));
    const current = await other.sync('payer-token', f.id, before.cursor);
    assert.equal(current.events.length, 1); assert.equal(current.cursor, String(BigInt(before.cursor) + 1n));
    assert.deepEqual(current.room, (await f.sync()).room);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('prior session domain format refuses even explicit initialization without rewriting its encrypted payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taply-room-legacy-')), path = join(dir, 'room.db'), key = randomBytes(32);
  const old = new DurableStore(path, key, 'handshake', () => ({ entries: new Map(), creates: new Map() }), true); old.close();
  const payload = () => {
    const db = new DatabaseSync(path);
    try { return db.prepare("SELECT payload FROM state WHERE name='handshake'").get()!.payload; }
    finally { db.close(); }
  };
  try {
    const before = payload();
    assert.throws(() => new SqliteSessionPersistence(path, key), /VERIFICATION_UNAVAILABLE/);
    assert.deepEqual(payload(), before);
    assert.throws(() => new SqliteSessionPersistence(path, key, true), /VERIFICATION_UNAVAILABLE/);
    assert.deepEqual(payload(), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
