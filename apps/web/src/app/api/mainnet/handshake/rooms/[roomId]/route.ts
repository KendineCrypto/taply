import { handleRoom } from '@/server/handshake/http';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { mainnetHandshakeDeps } from '@/server/mainnet/handshake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mainnet build only. join / sync / close for one room. */
export async function POST(request: Request, ctx: { params: Promise<{ roomId: string }> }): Promise<Response> {
  if (!IS_MAINNET_BUILD) return new Response(null, { status: 404 });
  return handleRoom(request, (await ctx.params).roomId, mainnetHandshakeDeps());
}
