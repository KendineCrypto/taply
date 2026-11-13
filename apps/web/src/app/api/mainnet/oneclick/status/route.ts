import { handleStatus } from '@/server/mainnet/oneclick/http';
import { serviceFromEnv } from '@/server/mainnet/oneclick/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mainnet build only (404 on Testnet). Cross-chain status HINT for a request's stored quote. */
export function GET(request: Request): Promise<Response> {
  return handleStatus(request, () => serviceFromEnv());
}
