import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { httpStatusOf } from './service';
import type { Result } from './service';

type Service = { prepareQuote(raw: unknown): Promise<Result<unknown>>; status(raw: unknown): Promise<Result<unknown>> };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });

function toResponse(result: Result<unknown>): Response {
  if (result.ok) return json(200, result.value);
  return json(httpStatusOf(result.code), { error: result.code, ...(result.reason ? { reason: result.reason } : {}) });
}

/** Browser calls only: same-origin JSON, small body. Cross-site posts are refused. */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (origin === null) return true; // non-browser client; still bound by every server-side check
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function handleQuote(request: Request, service: () => Service, mainnet = IS_MAINNET_BUILD): Promise<Response> {
  if (!mainnet) return json(404, { error: 'NOT_FOUND' });
  if (!sameOrigin(request)) return json(403, { error: 'FORBIDDEN' });
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json(415, { error: 'INVALID_INPUT' });
  const text = await request.text();
  if (text.length > 2048) return json(413, { error: 'INVALID_INPUT' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'INVALID_INPUT' });
  }
  return toResponse(await service().prepareQuote(body));
}

export async function handleStatus(request: Request, service: () => Service, mainnet = IS_MAINNET_BUILD): Promise<Response> {
  if (!mainnet) return json(404, { error: 'NOT_FOUND' });
  const requestId = new URL(request.url).searchParams.get('requestId');
  return toResponse(await service().status(requestId));
}
