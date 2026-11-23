import { createMainnetReader } from '@taply/near-client';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { redisFromEnv } from '@/server/handshake/redis';
import { createOneClickClient } from '../oneclick/client';
import { createCrosschainService, redisStore } from './service';
import { deliveryVerifier } from './proof';

/** Independent kill switch. Existing payment-mode variables never enable swap funding. */
export function crosschainMode(env: Readonly<Record<string, string | undefined>> = process.env): 'off' | 'dry' | 'funded' {
  if (!IS_MAINNET_BUILD) return 'off';
  if (env['TAPLY_CROSSCHAIN_MODE'] === 'funded') return env['VERCEL_ENV'] === 'preview' ? 'funded' : 'off';
  return env['TAPLY_CROSSCHAIN_MODE'] === 'dry' ? 'dry' : 'off';
}
export function crosschainService(env: Readonly<Record<string, string | undefined>> = process.env) {
  const redis = redisFromEnv(env);
  return createCrosschainService({ client: createOneClickClient({ apiKey: env['TAPLY_ONECLICK_API_KEY'] }), store: redis ? redisStore(redis) : null, now: Date.now, mode: crosschainMode(env), verify: deliveryVerifier(env),
    registered: async account => {
      if (!MAINNET_CONFIG.ok || !MAINNET_CONFIG.profile) throw new Error('MAINNET_CONFIG');
      return (await createMainnetReader(MAINNET_CONFIG.profile).readUsdcStorage(account)).data !== null;
    } });
}
