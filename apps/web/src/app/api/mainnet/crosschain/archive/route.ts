import { post } from '@/server/mainnet/crosschain/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => post(request, 'archive');
