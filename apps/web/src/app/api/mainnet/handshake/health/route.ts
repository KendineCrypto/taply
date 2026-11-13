import { handleHealth } from '@/server/handshake/http';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { mainnetHandshakeDeps } from '@/server/mainnet/handshake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mainnet build only (Testnet builds never route here). Room store reachability. */
export function GET(): Promise<Response> | Response {
  if (!IS_MAINNET_BUILD) return new Response(null, { status: 404 });
  return handleHealth(mainnetHandshakeDeps());
}
