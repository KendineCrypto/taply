import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomFixture } from './room-fixture.mts';
import { roomEventStream } from '../src/room.mts';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const TX = '11111111111111111111111111111113';

test('room stages, reviews and comparison code travel in an atomic ordered snapshot/cursor', async () => {
  const f = await roomFixture();
  const created = await f.engine.sync('merchant-token', f.id);
  assert.equal(created.room.phase, 'WAITING_FOR_BIND'); assert.equal(created.cursor, '1');
  assert.equal(created.events[0].type, 'session.created');
  await f.bind();
  assert.equal((await f.engine.sync('merchant-token', f.id)).room.phase, 'WAITING_FOR_CUSTOMER');
  await f.join(); assert.equal((await f.sync()).room.phase, 'WAITING_FOR_REVIEW');
  await f.review('merchant-token');
  assert.deepEqual((await f.sync()).room.reviews, { merchant: true, payer: false });
  await f.review('payer-token');
  const final = await f.sync();
  assert.equal(final.room.phase, 'WAITING_FOR_WALLET'); assert.ok(final.room.session.comparisonCode);
  assert.equal(final.room.session.state, 'REVIEWED');
  assert.deepEqual(final.room, final.events.at(-1)!.room);
  assert.deepEqual(final.events.map(e => e.eventId), ['1', '2', '3', '4', '5']);
  const other = await f.engine.sync('merchant-token', f.id, final.cursor);
  assert.deepEqual(other.events, []); assert.deepEqual(other.room, final.room);
  assert.equal(other.cursor, final.cursor);
  assert.ok(!JSON.stringify(final).includes(f.created.joinToken));
  assert.ok(!JSON.stringify(final).includes('payer-token'));
  final.events[0].room.session.merchantAccountId = 'attacker.testnet';
  assert.equal((await f.sync()).events[0].room.session.merchantAccountId, 'merchant.testnet');
});

test('idempotent progress uses canonical bodies and stale concurrent cursors cannot overwrite newer state', async () => {
  const f = await roomFixture(); await f.ready();
  const cursor = (await f.sync()).cursor;
  const input = { expectedCursor: cursor, phase: 'AWAITING_WALLET', termsHash: f.record.termsHash, transactionHash: null };
  const first = await f.engine.progress('payer-token', f.id, 'room_progress_0001', input);
  const retry = await f.engine.progress('payer-token', f.id, 'room_progress_0001', {
    transactionHash: null, termsHash: f.record.termsHash, phase: 'AWAITING_WALLET', expectedCursor: cursor });
  assert.deepEqual(first, retry);
  assert.equal((await f.sync()).cursor, first.cursor);
  const sameState = await f.engine.progress('payer-token', f.id, 'room_progress_noop', { ...input, expectedCursor: first.cursor });
  assert.equal(sameState.cursor, first.cursor); assert.deepEqual(sameState.events, []);
  await assert.rejects(f.engine.progress('payer-token', f.id, 'room_progress_0002', input), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.engine.progress('payer-token', f.id, 'room_progress_0001', { ...input, phase: 'USER_REJECTED' }), /IDEMPOTENCY_CONFLICT/);
  assert.equal((await f.sync()).cursor, first.cursor);
});

test('presence input cannot be changed while authentication is pending', async () => {
  const f = await roomFixture(); await f.bind(); await f.join();
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const { SessionEngine } = await import('../src/sessions.mts');
  const engine = new SessionEngine(f.store, { ...f.deps, authenticate: async credential => { await wait; return f.deps.authenticate(credential); } });
  const input = { connectionId: A, sequence: '1', state: 'active' };
  const pending = engine.roomPresence('payer-token', f.id, input);
  input.state = 'disconnected'; input.connectionId = B;
  release(); assert.equal((await pending).room.presence.payer, 'active');
  assert.equal((await engine.roomPresence('payer-token', f.id, { connectionId: A, sequence: '2', state: 'disconnected' })).room.presence.payer, 'disconnected');
});

for (const phase of ['SUBMITTED', 'OUTCOME_UNKNOWN'] as const) test(`${phase} is a payer hint, never Paid or permission to sign again`, async () => {
  const f = await roomFixture(); await f.ready();
  const opening = await f.engine.progress('payer-token', f.id, 'room_progress_0001', {
    expectedCursor: (await f.sync()).cursor, phase: 'AWAITING_WALLET', termsHash: f.record.termsHash, transactionHash: null });
  const result = await f.engine.progress('payer-token', f.id, 'room_progress_0002', {
    expectedCursor: opening.cursor, phase, termsHash: f.record.termsHash, transactionHash: phase === 'SUBMITTED' ? TX : null });
  assert.equal(result.room.phase, phase === 'SUBMITTED' ? 'PENDING_CHAIN' : 'BLOCKED');
  assert.equal(result.room.authority, 'coordination_only');
  assert.equal(result.room.session.state, 'REVIEWED');
  assert.ok(!JSON.stringify(result).match(/FINAL_PAID|verified_final|"paid"|"verified"/));
  f.advance(119000);
  await assert.rejects(f.engine.progress('payer-token', f.id, 'room_progress_0003', {
    expectedCursor: (await f.sync()).cursor, phase: 'AWAITING_WALLET', termsHash: f.record.termsHash, transactionHash: null }), /RECONCILIATION_REQUIRED/);
  f.advance(1000);
  const expired = await f.sync(); assert.equal(expired.room.phase, 'EXPIRED');
  assert.equal(expired.room.payerProgress?.phase, phase); // No automatic release/retry/reset.
});

test('progress requires joined payer, both reviews, exact terms and strict non-finality input', async () => {
  const f = await roomFixture(); await f.bind(); await f.join();
  const data = { phase: 'AWAITING_WALLET', expectedCursor: (await f.sync()).cursor, termsHash: f.record.termsHash, transactionHash: null };
  await assert.rejects(f.engine.progress('payer-token', f.id, 'room_progress_0001', data), /NOT_AUTHORIZED/);
  await f.review('merchant-token'); await f.review('payer-token'); data.expectedCursor = (await f.sync()).cursor;
  for (const actor of ['merchant-token', 'outsider-token', 'invalid-token']) await assert.rejects(f.engine.progress(actor, f.id, 'room_progress_0001', data), /NOT_AUTHORIZED|AUTH_REQUIRED/);
  for (const injected of [{ ...data, paid: true }, { ...data, phase: 'FINAL_PAID' }, { ...data, phase: 'INDEPENDENTLY_VERIFIED' }, { ...data, transactionHash: 'forged' }]) {
    await assert.rejects(f.engine.progress('payer-token', f.id, 'room_progress_0001', injected), /INVALID_ARGUMENT|Invalid/);
  }
  await assert.rejects(f.engine.progress('payer-token', f.id, 'room_progress_0001', { ...data, termsHash: 'f'.repeat(64) }), /TERMS_MISMATCH/);
  await assert.rejects(f.engine.progress('payer-token', f.id, 'room_progress_0001', { ...data, phase: 'SUBMITTED', transactionHash: TX }), /NOT_AUTHORIZED/);
  assert.equal((await f.sync()).cursor, data.expectedCursor);
});

test('presence aggregates tabs, ignores delayed disconnects, deduplicates renewals and survives resumption', async () => {
  const f = await roomFixture(); await f.bind(); await f.join();
  assert.deepEqual((await f.sync()).room.presence, { merchant: 'joined', payer: 'joined' });
  const touch = (connectionId: string, sequence: string, state = 'active') => f.engine.roomPresence('payer-token', f.id, { connectionId, sequence, state });
  const active = await touch(A, '1'); assert.equal(active.room.presence.payer, 'active');
  f.advance(1000);
  assert.equal((await touch(A, '1')).cursor, active.cursor); // Duplicate does not extend lease.
  await touch(B, '1'); await touch(A, '3', 'disconnected');
  assert.equal((await touch(A, '2')).room.session.presence.payer, true); // Old reconnect ignored; B still active.
  await assert.rejects(touch(A, '3'), /IDEMPOTENCY_CONFLICT/);
  const disconnected = await touch(B, '2', 'disconnected');
  assert.equal(disconnected.room.presence.payer, 'disconnected');
  const resumed = await touch(B, '3'); assert.equal(resumed.room.presence.payer, 'resumed');
  f.advance(30000);
  assert.equal((await f.sync()).room.presence.payer, 'disconnected');
  const cursor = (await f.sync()).cursor;
  assert.equal((await touch(B, '3')).cursor, cursor); // Replaying heartbeat cannot resurrect activity.
  assert.equal((await f.sync()).room.session.payerAccountId, 'payer.testnet');
});

test('retired credential cannot clear newer-login presence or mutate after revocation', async () => {
  const f = await roomFixture(); await f.bind(); await f.join();
  await f.engine.roomPresence('payer-token', f.id, { connectionId: A, sequence: '1', state: 'active' });
  await f.engine.roomPresence('payer-new-token', f.id, { connectionId: A, sequence: '1', state: 'active' });
  f.credentials.delete('payer-token'); f.engine.disconnectCredential('payer-token');
  assert.equal((await f.engine.sync('payer-new-token', f.id)).room.session.presence.payer, true);
  await assert.rejects(f.engine.sync('payer-token', f.id), /AUTH_REQUIRED/);
  await assert.rejects(f.engine.roomPresence('payer-token', f.id, { connectionId: A, sequence: '2', state: 'disconnected' }), /AUTH_REQUIRED/);
  await assert.rejects(f.engine.sync('outsider-token', f.id), /NOT_AUTHORIZED/);
});

test('bounded reconnect reset includes atomic current room and stable high-water cursor', async () => {
  const f = await roomFixture(); await f.bind(); await f.join();
  for (let i = 1; i <= 80; i++) await f.engine.roomPresence('payer-token', f.id, { connectionId: A, sequence: String(i), state: i % 2 ? 'active' : 'disconnected' });
  const reset = await f.sync(); assert.equal(reset.reset, true); assert.deepEqual(reset.events, []);
  assert.equal(reset.room.session.presence.payer, false);
  const recent = await f.engine.sync('payer-token', f.id, String(BigInt(reset.cursor) - 2n));
  assert.equal(recent.reset, false); assert.equal(recent.events.length, 2);
  assert.deepEqual(recent, await f.engine.sync('payer-token', f.id, String(BigInt(reset.cursor) - 2n)));
  assert.deepEqual(recent.events.at(-1)!.room, recent.room);
  const future = await f.engine.sync('payer-token', f.id, '9999999999999999');
  assert.equal(future.reset, true); assert.equal(future.cursor, reset.cursor);
  for (const bad of ['01', '-1', '1\nid:evil', '10000000000000000']) await assert.rejects(f.engine.sync('payer-token', f.id, bad), /INVALID_ARGUMENT/);
  const frames = roomEventStream(recent);
  assert.match(frames, /^retry: 6000\n/); assert.ok(frames.endsWith('\n\n'));
  assert.match(frames, /event: room.changed/); assert.match(frames, /event: room.snapshot/);
  assert.match(roomEventStream(reset), /event: room.reset/);
  assert.ok(!frames.includes('payer-token'));
});

test('connection storage is bounded and closed rooms never retain active presence', async () => {
  const f = await roomFixture(); await f.ready();
  for (let i = 0; i < 8; i++) await f.engine.roomPresence('payer-token', f.id, { connectionId: `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`, sequence: '1', state: 'active' });
  await assert.rejects(f.engine.roomPresence('payer-token', f.id, { connectionId: B, sequence: '1', state: 'active' }), /RATE_LIMITED/);
  // One role cannot exhaust the other role's liveness budget.
  await f.engine.roomPresence('merchant-token', f.id, { connectionId: B, sequence: '1', state: 'active' });
  await f.engine.close('merchant-token', f.id);
  const result = await f.sync(); assert.equal(result.room.phase, 'CLOSED');
  assert.equal(result.room.session.presence.payer, false);
  assert.equal(result.events.at(-1)!.room.session.presence.payer, false);
  assert.equal(result.events.at(-1)!.type, 'session.closed');
});
