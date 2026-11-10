import { defaultDeps, handleRoom } from '@/server/handshake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }): Promise<Response> {
  const { roomId } = await context.params;
  return handleRoom(request, roomId, defaultDeps());
}
