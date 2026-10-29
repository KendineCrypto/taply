import { createNearTestnetClient } from '@taply/near-client';
import type { NearTestnetClient } from '@taply/near-client';
import { CHAIN_CONFIG } from './config';

/**
 * The only place `@taply/near-client` is instantiated in apps/web.
 *
 * Returns null when the build's chain configuration is invalid, so callers must
 * render a "chain unavailable" state instead of reading from somewhere else.
 */
let client: NearTestnetClient | null | undefined;

export function getNearClient(): NearTestnetClient | null {
  if (client === undefined) {
    client = CHAIN_CONFIG.ok ? createNearTestnetClient(CHAIN_CONFIG.client) : null;
  }
  return client;
}

export type { NativeBalance, NearTestnetClient, ReadResult, RpcErrorCode } from '@taply/near-client';
