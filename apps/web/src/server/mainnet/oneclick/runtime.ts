import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { FIXTURE_TOKENS, fixtureById } from '@/lib/mainnet/fixtures';
import { redisFromEnv } from '@/server/handshake/redis';
import { fixtureChain, readerChain } from '../chain';
import { createOneClickClient } from './client';
import { createFixtureClient, createFixtureSigner } from './fixture-client';
import type { FixtureSigner } from './fixture-client';
import { createOneClickService, parseOneClickMode } from './service';
import type { OneClickMode } from './service';
import { memoryQuoteStore, redisQuoteStore } from './store';
import type { QuoteStore } from './store';
import { MANAGER_PUBLIC_KEY } from './verify';
import { createBaseRpc } from './origin-evidence';
import type { RedisCommand } from '@/server/handshake/redis';
import { limiterFromEnv } from './rate-limit';

/**
 * Composition root for the 1Click service from server-only env:
 *   TAPLY_ONECLICK_MODE   off (default) | fixture | dry | funded (refused in code until
 *                         ONECLICK_FUNDED_QUOTES_RELEASE_APPROVED)
 *   TAPLY_ONECLICK_API_KEY optional, Bearer, server only
 *   KV_REST_API_URL/TOKEN  mainnet project's own Upstash database (dry/funded)
 *   TAPLY_BASE_RPC_URL     server only, may carry a provider key; Base JSON-RPC with eth_getLogs.
 *                          Default https://mainnet.base.org. Used only for release evidence;
 *                          if it cannot be read, expired attempts simply stay blocked.
 *
 * A Testnet build always resolves to `off`. Fixture mode is refused on Vercel
 * Production here and in scripts/check-mainnet-env.mjs.
 */
let fixtureSigner: FixtureSigner | null = null;
let fixtureStore: QuoteStore | null = null;

export function resolveMode(env: Readonly<Record<string, string | undefined>>, mainnet: boolean): OneClickMode {
  if (!mainnet) return 'off';
  const mode = parseOneClickMode(env['TAPLY_ONECLICK_MODE']);
  if (mode === 'fixture' && env['VERCEL_ENV'] === 'production') return 'off';
  return mode;
}

export function serviceFromEnv(env: Readonly<Record<string, string | undefined>> = process.env) {
  const mode = resolveMode(env, IS_MAINNET_BUILD);
  if (mode === 'fixture') {
    fixtureSigner ??= createFixtureSigner();
    fixtureStore ??= memoryQuoteStore();
    return createOneClickService({
      mode,
      chain: fixtureChain(),
      client: createFixtureClient(fixtureSigner),
      store: fixtureStore,
      managerPublicKey: fixtureSigner.publicKey,
      now: Date.now,
      rateLimit: (id, kind = 'quote') => limiterFromEnv(env)([{ key: `request:${kind}:${id}`, limit: kind === 'status' ? 40 : 10 }]),
      fixtureHint: (id) => fixtureById(id, Date.now())?.scenario.oneClick ?? null,
      fixtureTokens: () => FIXTURE_TOKENS,
    });
  }
  const redis = redisFromEnv(env);
  return createOneClickService({
    mode,
    chain: MAINNET_CONFIG.ok && MAINNET_CONFIG.profile !== null ? readerChain(MAINNET_CONFIG.profile) : null,
    client: createOneClickClient({ apiKey: env['TAPLY_ONECLICK_API_KEY'] }),
    store: redis === null ? null : redisQuoteStore(redis),
    managerPublicKey: MANAGER_PUBLIC_KEY,
    now: Date.now,
    rateLimit: (id, kind = 'quote') => limiterFromEnv(env)([{ key: `request:${kind}:${id}`, limit: kind === 'status' ? 40 : 10 }]),
    originRpc: createBaseRpc({ url: baseRpcUrl(env) }),
    ...(redis === null ? {} : { statusCache: redisStatusCache(redis) }),
  });
}

/** https only; anything else falls back to the public endpoint (which may rate-limit, so attempts stay blocked). */
export function baseRpcUrl(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env['TAPLY_BASE_RPC_URL'];
  try { if (raw && new URL(raw).protocol === 'https:') return raw; } catch { /* ignored */ }
  return 'https://mainnet.base.org';
}

function redisStatusCache(redis: RedisCommand) {
  const key = (k: string) => `taply:mainnet:1click:status-cache:${k}`;
  return {
    async get(k: string) { const v = await redis(['GET', key(k)]); return typeof v === 'string' ? v : null; },
    async set(k: string, v: string, ttlMs: number) { await redis(['SET', key(k), v, 'PX', ttlMs]); },
  };
}
