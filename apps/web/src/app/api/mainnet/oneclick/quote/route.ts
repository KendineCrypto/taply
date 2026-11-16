import { handleQuote } from '@/server/mainnet/oneclick/http';
import { serviceFromEnv } from '@/server/mainnet/oneclick/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mainnet build only (404 on Testnet). Prepares a verified 1Click quote; a deposit address only to its owner and only when funding is approved. */
export function POST(request: Request): Promise<Response> {
  return handleQuote(request, () => serviceFromEnv());
}
