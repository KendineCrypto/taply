import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRoomCatchUp } from '../dist/index.js';
const id = '11111111-1111-4111-8111-111111111111';
const scope = { sessionId: id, accountId: 'merchant.testnet', authGeneration: 1 };
function sync(cursor = '1', reset = false) {
  const room = { schemaVersion: 'taply.room.v1', authority: 'coordination_only',
    session: { id, nonce: 'a'.repeat(64), expiresAtNs: '1793500120000000000', state: 'DRAFT', merchantAccountId: scope.accountId,
      payerAccountId: null, intentId: null, termsHash: null, comparisonCode: null, presence: { merchant: false, payer: false } },
    phase: 'WAITING_FOR_BIND', reviews: { merchant: false, payer: false }, presence: { merchant: 'joined', payer: null }, payerProgress: null };
  const event = { schemaVersion: 'taply.room-event.v1', eventId: cursor, sessionId: id, emittedAt: '2026-11-01T00:00:00.000Z', type: 'session.created', room };
  return { schemaVersion: 'taply.room-sync.v1', sessionId: id, cursor, reset, serverTimeMs: 1793500000000, room, events: reset ? [] : [event] };
}
test('replacement snapshots survive duplicate/reordered delivery, reconnect gaps and auth generation changes', () => {
  const first = applyRoomCatchUp(null, sync(), scope, 1);
  const second = applyRoomCatchUp(first, sync('2'), scope, 1);
  assert.strictEqual(applyRoomCatchUp(second, sync(), scope, 1), second);
  assert.strictEqual(applyRoomCatchUp(second, sync('2'), scope, 1), second);
  assert.strictEqual(applyRoomCatchUp(second, { paid: true }, scope, 0), second);
  assert.throws(() => applyRoomCatchUp(second, sync('4'), scope, 1), /REFRESH_REQUIRED/);
  assert.equal(applyRoomCatchUp(second, sync('100', true), scope, 1).cursor, '100');
  const switched = { ...scope, authGeneration: 2 };
  assert.equal(applyRoomCatchUp(null, sync(), switched, 1), null);
});
test('malicious room events cannot inject Paid, cross sessions/accounts, contradict cursors or supply unbounded history', () => {
  for (const mutate of [s => { s.room.paid = true; }, s => { s.room.authority = 'chain'; },
    s => { s.events[0].eventId = '2'; }, s => { s.events[0].sessionId = '22222222-2222-4222-8222-222222222222'; },
    s => { s.events = Array(65).fill(s.events[0]); }, s => { s.reset = true; },
    s => { s.room.phase = 'VERIFIED_PAID'; }]) {
    const bad = sync(); mutate(bad); assert.throws(() => applyRoomCatchUp(null, bad, scope, 1));
  }
  assert.throws(() => applyRoomCatchUp(null, sync(), { ...scope, accountId: 'eve.testnet' }, 1), /SESSION_MISMATCH/);
  const original = applyRoomCatchUp(null, sync(), scope, 1), conflict = sync();
  conflict.room.presence.merchant = 'active';
  assert.throws(() => applyRoomCatchUp(original, conflict, scope, 1), /CONFLICT/);
});
