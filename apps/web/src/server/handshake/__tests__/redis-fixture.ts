// @vitest-environment node
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { restRedis } from '../redis';
import type { RedisCommand } from '../redis';
// @ts-expect-error -- plain .mjs dev tool without types
import { startRestShim } from '../../../../scripts/redis-rest-shim.mjs';

/** A REAL redis-server behind the Upstash REST protocol (local shim). */
export const hasRedis = (() => { try { execFileSync('redis-server', ['--version']); return true; } catch { return false; } })();
const freePort = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });

export async function startRedis(): Promise<{ cmd: RedisCommand; stop: () => Promise<void> }> {
  const port = await freePort();
  const redis: ChildProcess = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  const shim = (await startRestShim({ redisPort: port, token: 'test-token' })) as { url: string; stop: () => Promise<void> };
  return { cmd: restRedis({ url: shim.url, token: 'test-token' }), stop: async () => { await shim.stop(); redis.kill(); } };
}
