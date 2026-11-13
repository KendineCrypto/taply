import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { fixtureById } from '@/lib/mainnet/fixtures';
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
import { limiterFromEnv } from './rate-limit';

/**
 * Composition root for the 1Click service from server-only env:
 *   TAPLY_ONECLICK_MODE   off (default) | fixture | dry | funded (refused in code)
 *   TAPLY_ONECLICK_API_KEY optional, Bearer, server only
 *   KV_REST_API_URL/TOKEN  mainnet project's own Upstash database (dry/funded)
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
      rateLimit: id => limiterFromEnv(env)([{ key: `request:${id}`, limit: 30 }]),
      fixtureHint: (id) => fixtureById(id, Date.now())?.scenario.oneClick ?? null,
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
    rateLimit: id => limiterFromEnv(env)([{ key: `request:${id}`, limit: 30 }]),
  });
}
