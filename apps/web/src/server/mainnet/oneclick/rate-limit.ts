import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { redisFromEnv, type RedisCommand } from '@/server/handshake/redis';

export type RateLimit = (keys: ReadonlyArray<{ key: string; limit: number }>) => Promise<boolean>;
// Atomic check + consume. Redis owns the window clock; rejected requests do not
// extend TTL. Short-lived rate counters are separate from no-TTL attempt ledgers.
const CONSUME = `
for i,key in ipairs(KEYS) do
  if tonumber(redis.call('GET',key) or '0') >= tonumber(ARGV[i]) then return 0 end
end
for _,key in ipairs(KEYS) do
  if redis.call('INCR',key) == 1 then redis.call('PEXPIRE',key,60000) end
end
return 1`;
export function redisRateLimit(redis: RedisCommand): RateLimit {
  return async keys => await redis(['EVAL', CONSUME, keys.length,
    ...keys.map(k => `taply:mainnet:1click:rate:${k.key}`), ...keys.map(k => k.limit)]) === 1;
}
export function memoryRateLimit(now = Date.now): RateLimit {
  const counts = new Map<string, { count: number; until: number }>();
  return async keys => {
    for (const [key, entry] of counts) if (entry.until <= now()) counts.delete(key);
    if (keys.some(k => (counts.get(k.key)?.count ?? 0) >= k.limit)) return false;
    for (const k of keys) {
      const entry = counts.get(k.key) ?? { count: 0, until: now() + 60_000 };
      entry.count++; counts.set(k.key, entry);
    }
    return true;
  };
}
const fixtureLimiter = memoryRateLimit();
export function limiterFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): RateLimit {
  if (env['TAPLY_ONECLICK_MODE'] === 'fixture' && env['VERCEL_ENV'] !== 'production') return fixtureLimiter;
  const redis = redisFromEnv(env);
  return redis ? redisRateLimit(redis) : async () => { throw new Error('LIMITER_UNAVAILABLE'); };
}
export function clientBucket(request: Request, env: Readonly<Record<string, string | undefined>> = process.env): string {
  // Trust Vercel's overwritten header only on that platform. Else collapse all
  // clients into one bucket; arbitrary XFF cannot mint rate-limit identities.
  const raw = env['VERCEL'] === '1' ? request.headers.get('x-forwarded-for')?.trim() : null;
  const ip = raw && isIP(raw) ? raw.toLowerCase() : 'untrusted-shared';
  const canonical = ip.includes(':') ? new URL(`http://[${ip}]`).hostname : ip;
  return createHash('sha256').update(canonical).digest('hex');
}
export async function ingress(request: Request): Promise<boolean> {
  return limiterFromEnv()([{ key: 'global', limit: 240 }, { key: `ip:${clientBucket(request)}`, limit: 60 }]);
}
