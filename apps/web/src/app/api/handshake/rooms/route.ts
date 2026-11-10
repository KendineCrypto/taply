import { defaultDeps, handleCreate } from '@/server/handshake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return handleCreate(request, defaultDeps());
}
