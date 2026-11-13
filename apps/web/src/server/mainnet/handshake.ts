import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { nsToDate } from '@/lib/format/time';
import { redisFromEnv } from '@/server/handshake/redis';
import type { HandshakeDeps } from '@/server/handshake/http';
import { fixtureChain, readerChain } from './chain';
import type { ChainView } from './chain';

/**
 * Live Handshake for the NEAR Mainnet build: the SAME reviewed room engine as
 * Testnet (server/handshake/rooms.ts), with
 *  - its own Redis key namespace (`taply:mainnet:hs`), in the mainnet project's
 *    own Upstash database (docs/MAINNET_INFRA.md §4.1);
 *  - room creation only for a request that is OPEN on the pinned MAINNET
 *    contract at a final block (genesis + code hash checked by near-client),
 *    or on the labelled fixture chain in a fixture Preview.
 * The room coordinates two screens. It never settles, signs or marks paid.
 */
export const MAINNET_ROOM_NAMESPACE = 'taply:mainnet:hs';

export function mainnetHandshakeEnabled(env: Readonly<Record<string, string | undefined>> = process.env, mainnet = IS_MAINNET_BUILD): boolean {
  return mainnet && env['NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE'] === 'on';
}

export function openDeadlineFrom(chain: ChainView | null, now: () => number = Date.now) {
  return async (requestId: string): Promise<number | null> => {
    if (chain === null) return null;
    const { request } = await chain.readRequest(requestId);
    if (request === null || request.status !== 'OPEN' || request.terms.mode !== 'instant') return null;
    const expiresAtMs = nsToDate(request.terms.fundingExpiresAtNs).getTime();
    return expiresAtMs > now() ? expiresAtMs : null;
  };
}

export function mainnetHandshakeDeps(env: Readonly<Record<string, string | undefined>> = process.env): HandshakeDeps {
  const enabled = mainnetHandshakeEnabled(env);
  const chain: ChainView | null = !MAINNET_CONFIG.ok
    ? null
    : MAINNET_CONFIG.fixtures && env['VERCEL_ENV'] !== 'production'
      ? fixtureChain()
      : MAINNET_CONFIG.profile !== null ? readerChain(MAINNET_CONFIG.profile) : null;
  return {
    redis: enabled ? redisFromEnv(env) : null,
    openRequestDeadlineMs: openDeadlineFrom(chain),
    namespace: MAINNET_ROOM_NAMESPACE,
  };
}
