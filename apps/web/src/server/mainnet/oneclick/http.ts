import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';
import { httpStatusOf } from './service';
import type { Result } from './service';
import { boundedText } from './bounded-body';
import { ingress } from './rate-limit';

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

export async function handleQuote(request: Request, service: () => Service, mainnet = IS_MAINNET_BUILD, admit = ingress): Promise<Response> {
  if (!mainnet) return json(404, { error: 'NOT_FOUND' });
  if (!sameOrigin(request)) return json(403, { error: 'FORBIDDEN' });
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json(415, { error: 'INVALID_INPUT' });
  try { if (!await admit(request)) return json(429, { error: 'RATE_LIMITED' }); }
  catch { return json(503, { error: 'STORE_UNAVAILABLE' }); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  let text: string;
  try {
    const length = request.headers.get('content-length');
    if (length && /^\d+$/.test(length) && BigInt(length) > 2048n) {
      void request.body?.cancel().catch(() => undefined);
      return json(413, { error: 'INVALID_INPUT' });
    }
    text = await boundedText(request.body, 2048, controller.signal);
  } catch (error) {
    return json(controller.signal.aborted ? 408 : error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'INVALID_INPUT' });
  } finally { clearTimeout(timer); }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'INVALID_INPUT' });
  }
  return toResponse(await service().prepareQuote(body));
}

export async function handleStatus(request: Request, service: () => Service, mainnet = IS_MAINNET_BUILD, admit = ingress): Promise<Response> {
  if (!mainnet) return json(404, { error: 'NOT_FOUND' });
  try { if (!await admit(request)) return json(429, { error: 'RATE_LIMITED' }); }
  catch { return json(503, { error: 'STORE_UNAVAILABLE' }); }
  const requestId = new URL(request.url).searchParams.get('requestId');
  return toResponse(await service().status(requestId));
}
