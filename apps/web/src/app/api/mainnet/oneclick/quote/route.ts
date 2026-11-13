import { handleQuote } from '@/server/mainnet/oneclick/http';
import { serviceFromEnv } from '@/server/mainnet/oneclick/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mainnet build only (404 on Testnet). Prepares a verified 1Click quote; never returns a fundable deposit address. */
export function POST(request: Request): Promise<Response> {
  return handleQuote(request, () => serviceFromEnv());
}
