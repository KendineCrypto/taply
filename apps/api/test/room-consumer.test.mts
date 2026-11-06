import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomFixture } from './room-fixture.mts';
import { roomEventStream } from '../src/room.mts';
import { applyRoomCatchUp } from '../../../packages/near-client/dist/index.js';

test('two independent room consumers converge across visibility, reordered catch-up, close and logout fencing', async () => {
  const f = await roomFixture(); await f.ready();
  const merchant = { sessionId: f.id, accountId: 'merchant.testnet', authGeneration: 1 };
  const payer = { ...merchant, accountId: 'payer.testnet' };
  const first = await f.sync();
  let a = applyRoomCatchUp(null, first, merchant, 1), b = applyRoomCatchUp(null, first, payer, 1);
  const connectionId = '11111111-1111-4111-8111-111111111111';
  const active = await f.engine.roomPresence('payer-token', f.id, { connectionId, sequence: '1', state: 'active' });
  const hidden = await f.engine.roomPresence('payer-token', f.id, { connectionId, sequence: '2', state: 'disconnected' });
  const visible = await f.engine.roomPresence('payer-token', f.id, { connectionId, sequence: '3', state: 'active' });
  assert.equal(visible.room.presence.payer, 'resumed');
  // Fetch independent complete catch-ups from each client's last cursor.
  a = applyRoomCatchUp(a, await f.engine.sync('merchant-token', f.id, a!.cursor), merchant, 1);
  b = applyRoomCatchUp(b, await f.engine.sync('payer-token', f.id, b!.cursor), payer, 1);
  assert.deepEqual(a!.room, b!.room);
  assert.strictEqual(applyRoomCatchUp(b, hidden, payer, 1), b);
  assert.strictEqual(applyRoomCatchUp(b, active, payer, 1), b);
  const lateHidden = await f.engine.roomPresence('payer-token', f.id, { connectionId, sequence: '2', state: 'disconnected' });
  assert.equal(lateHidden.cursor, visible.cursor);
  await f.engine.close('merchant-token', f.id);
  const closed = await f.engine.sync('payer-token', f.id, b!.cursor);
  a = applyRoomCatchUp(a, closed, merchant, 1); b = applyRoomCatchUp(b, closed, payer, 1);
  assert.deepEqual(a!.room, b!.room); assert.equal(a!.room.phase, 'CLOSED');
  assert.equal(a!.room.authority, 'coordination_only');
  assert.equal(applyRoomCatchUp(b, visible, { ...payer, authGeneration: 2 }, 1), null);
  await assert.rejects(f.engine.roomPresence('payer-token', f.id, { connectionId, sequence: '4', state: 'active' }), /NOT_AUTHORIZED/);
  const oversized = { ...first, events: Array(65).fill(first.events[0]) };
  assert.throws(() => roomEventStream(oversized), /RATE_LIMITED/);
  const bloated = structuredClone(first); bloated.room.session.nonce = 'x'.repeat(300000);
  assert.throws(() => roomEventStream(bloated), /RATE_LIMITED/);
});
