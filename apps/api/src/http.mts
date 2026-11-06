import { randomUUID } from 'node:crypto';
import { ApiErrorSchema } from '../../../packages/shared/dist/index.js';

/** Refusal-only Fetch handler. No server, auth cookies, RPC or mutations. */
export function handle(request: Request): Response {
  const url = new URL(request.url);
  const code = url.pathname === '/api/v1/auth/me' ? 'AUTH_REQUIRED' : 'VERIFICATION_UNAVAILABLE';
  const body = ApiErrorSchema.parse({ schemaVersion: 'taply.api.v1', error: {
    code, messageKey: `errors.${code}`, requestId: randomUUID(), retryAction: 'NONE',
    retryAfterMs: null, details: {},
  } });
  return Response.json(body, { status: code === 'AUTH_REQUIRED' ? 401 : 503,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff' } });
}
