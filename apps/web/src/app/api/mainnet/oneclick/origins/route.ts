import { handleOrigins } from '@/server/mainnet/oneclick/http';
import { serviceFromEnv } from '@/server/mainnet/oneclick/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mainnet build only (404 on Testnet). Quotable origin assets, resolved from 1Click's own token list. */
export function GET(request: Request): Promise<Response> {
  return handleOrigins(request, () => serviceFromEnv());
}
