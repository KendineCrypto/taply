import { handleCreate } from '@/server/handshake/http';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { mainnetHandshakeDeps } from '@/server/mainnet/handshake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mainnet build only. Creates a room for an OPEN request on the pinned mainnet contract. */
export function POST(request: Request): Promise<Response> | Response {
  if (!IS_MAINNET_BUILD) return new Response(null, { status: 404 });
  return handleCreate(request, mainnetHandshakeDeps());
}
