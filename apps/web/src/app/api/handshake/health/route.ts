import { defaultDeps, handleHealth } from '@/server/handshake/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return handleHealth(defaultDeps());
}
