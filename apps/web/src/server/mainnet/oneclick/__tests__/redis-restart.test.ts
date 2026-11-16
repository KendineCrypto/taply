// @vitest-environment node
import { expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasRedis } from '../../../handshake/__tests__/redis-fixture';
import { restRedis } from '../../../handshake/redis';
import { redisQuoteStore, KEY_PREFIX } from '../store';
// @ts-expect-error development REST bridge has no declaration file
import { startRestShim } from '../../../../../scripts/redis-rest-shim.mjs';

it.skipIf(!hasRedis)('real Redis AOF survives SIGKILL/restart with a dispatched attempt, without TTL or a new reservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'taply-attempt-aof-'));
  const port = await new Promise<number>(resolve => { const s = createServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
  const launch = () => spawn('redis-server', ['--bind', '127.0.0.1', '--port', String(port), '--dir', dir, '--save', '', '--appendonly', 'yes', '--appendfsync', 'always'], { stdio: 'ignore' });
  let process: ChildProcess = launch();
  const readyPort = async () => {
    for (let n = 0; n < 50; n++) {
      const ready = await new Promise<boolean>(resolve => {
        const socket = connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
      });
      if (ready) return;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Redis failed to start');
  };
  await readyPort();
  let shim = await startRestShim({ redisPort: port, token: 'local-only' });
  let cmd = restRedis({ url: shim.url, token: 'local-only' });
  const kill = () => new Promise<void>(resolve => {
    if (process.exitCode !== null || process.signalCode !== null) { resolve(); return; }
    process.once('exit', () => resolve()); process.kill('SIGKILL');
  });
  try {
    expect(await cmd(['PING'])).toBe('PONG');
    const store = redisQuoteStore(cmd); const requestId = 'a'.repeat(64);
    const r = await store.reserve({ id: 'before-crash', requestId, mode: 'funded', payload: '{"dry":false}', createdAtMs: 1, deadlineMs: 1_000, ownerHash: 'owner' }, 1);
    if (r.kind !== 'RESERVED') throw new Error(r.kind);
    const a = r.attempt;
    expect(await store.transition(a, 'DISPATCHING')).toBe(true);
    expect(await cmd(['PTTL', `${KEY_PREFIX}ledger:v2:${requestId}`])).toBe(-1);
    // The development bridge deliberately has no reconnect implementation.
    // Recreate it, like a restarted worker, after the database's forced crash.
    await shim.stop(); await kill(); process = launch(); await readyPort();
    shim = await startRestShim({ redisPort: port, token: 'local-only' });
    cmd = restRedis({ url: shim.url, token: 'local-only' });
    const restarted = redisQuoteStore(cmd);
    expect((await restarted.attempts(requestId))[0]?.state).toBe('DISPATCHING');
    expect((await restarted.reserve({ id: 'after-crash', requestId, mode: 'funded', payload: '{}', createdAtMs: 2_000, deadlineMs: 3_000, ownerHash: 'other' }, 2_000)).kind).toBe('BUSY');
    expect(await restarted.transition({ ...a, fence: 2 }, 'DISPATCHING')).toBe(false);
    // Existing legacy records are quarantined, never silently bypassed.
    const legacy = 'b'.repeat(64);
    await cmd(['SET', `${KEY_PREFIX}quote:${legacy}`, '{}']);
    expect((await restarted.reserve({ id: 'legacy', requestId: legacy, mode: 'dry', payload: '{}', createdAtMs: 1, deadlineMs: 2, ownerHash: 'o' }, 1)).kind).toBe('LEGACY_BLOCKED');
    // A v1 ledger holding a funded attempt quarantines the request; a dry-only v1 ledger cannot be funded and is ignored.
    const v1 = 'c'.repeat(64);
    await cmd(['SET', `${KEY_PREFIX}ledger:v1:${v1}`, JSON.stringify({ version: 1, fence: 1, active: 'x', attempts: { x: { mode: 'funded' } } })]);
    expect((await restarted.reserve({ id: 'v1', requestId: v1, mode: 'dry', payload: '{}', createdAtMs: 1, deadlineMs: 2, ownerHash: 'o' }, 1)).kind).toBe('LEGACY_BLOCKED');
    const v1dry = 'd'.repeat(64);
    await cmd(['SET', `${KEY_PREFIX}ledger:v1:${v1dry}`, JSON.stringify({ version: 1, fence: 1, active: 'x', attempts: { x: { mode: 'dry' } } })]);
    expect((await restarted.reserve({ id: 'v1d', requestId: v1dry, mode: 'dry', payload: '{}', createdAtMs: 1, deadlineMs: 2, ownerHash: 'o' }, 1)).kind).toBe('RESERVED');
  } finally {
    await shim.stop(); await kill();
    await rm(dir, { recursive: true, force: true }); // only the unique test-owned temporary directory
  }
}, 15000);
