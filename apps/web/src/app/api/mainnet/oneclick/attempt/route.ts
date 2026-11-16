import { handleResume } from '@/server/mainnet/oneclick/http';
import { serviceFromEnv } from '@/server/mainnet/oneclick/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mainnet build only (404 on Testnet). The payer's own attempt, for the browser holding its secret. */
export function POST(request: Request): Promise<Response> {
  return handleResume(request, () => serviceFromEnv());
}
