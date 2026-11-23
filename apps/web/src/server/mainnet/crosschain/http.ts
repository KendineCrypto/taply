import { z } from 'zod';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { Secret } from '@/lib/mainnet/crosschain/model';
import { boundedText } from '../oneclick/bounded-body';
import { ingress } from '../oneclick/rate-limit';
import { crosschainMode, crosschainService } from './runtime';
export function json(status: number, value: unknown) { return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }); }
const errors = new Set(['SWAP_UNAVAILABLE','FUNDING_DISABLED','STORE_UNAVAILABLE','ATTEMPT_EXISTS','TOKEN_UNAVAILABLE','REGISTER_USDC','QUOTE_INVALID','QUOTE_EXPIRED','REVIEW_REQUIRED','PRICE_CHANGED','STATUS_MISMATCH','ADDRESS_INVALID']);
export async function post(request: Request, action: 'quote' | 'session' | 'archive') {
  if (!IS_MAINNET_BUILD) return json(404, { error: 'NOT_FOUND' });
  if (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin') return json(403, { error: 'FORBIDDEN' });
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json(403, { error: 'FORBIDDEN' });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: 'INVALID_INPUT' });
  try {
    if (!await ingress(request)) return json(429, { error: 'RATE_LIMITED' });
    const b = z.strictObject({ secret: Secret, input: z.unknown().optional(), fund: z.boolean().optional(), approvedMinimum: z.string().max(39).optional() }).parse(JSON.parse(await boundedText(request.body, 2048, AbortSignal.timeout(3000))));
    const svc = crosschainService();
    if (action === 'archive') { await svc.archive(b.secret); return json(200, { ok: true }); }
    return json(200, action === 'quote' ? await svc.quote(b.input, b.secret, b.fund ?? false, b.approvedMinimum) : await svc.session(b.secret));
  } catch (e) {
    const code = e instanceof Error && errors.has(e.message) ? e.message : e instanceof z.ZodError ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE';
    return json(code === 'INVALID_INPUT' || code === 'ADDRESS_INVALID' ? 400 : code === 'ATTEMPT_EXISTS' ? 409 : 503, { error: code });
  }
}
export function availability() { return IS_MAINNET_BUILD ? json(200, { mode: crosschainMode() }) : json(404, { error: 'NOT_FOUND' }); }
