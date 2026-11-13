/**
 * Bounded HTTP client for the documented 1Click API (base
 * https://1click.chaindefuser.com, endpoints /v0/quote, /v0/status, /v0/tokens).
 *
 *  - Server only. The optional API key is sent as `Authorization: Bearer`,
 *    exactly as the official SDK 0.1.26 does (OpenAPI.TOKEN), and never leaves
 *    the server.
 *  - No redirects, no caching, hard timeout and response size cap.
 *  - Upstream error text is never forwarded: it is mapped to a small code set
 *    with plain-language copy in the UI.
 */
export const ONECLICK_BASE_URL = 'https://1click.chaindefuser.com';

export type OneClickErrorCode = 'MIN_AMOUNT' | 'NO_LIQUIDITY' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'BAD_REQUEST' | 'UNAVAILABLE';

export class OneClickHttpError extends Error {
  constructor(readonly code: OneClickErrorCode) {
    super(`ONECLICK_${code}`);
  }
}

export interface OneClickClient {
  quote(body: unknown): Promise<unknown>;
  status(depositAddress: string, depositMemo: string | null): Promise<unknown>;
  tokens(): Promise<unknown>;
}

export function classifyUpstreamError(status: number, message: string): OneClickErrorCode {
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UNAVAILABLE';
  if (/too low|at least|minimum/i.test(message)) return 'MIN_AMOUNT';
  if (/liquidity|no route|no quote|failed to get quote/i.test(message)) return 'NO_LIQUIDITY';
  return 'BAD_REQUEST';
}

export function createOneClickClient(input: {
  readonly apiKey?: string | undefined;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}): OneClickClient {
  const fetcher = input.fetcher ?? ((u, i) => globalThis.fetch(u, i));
  const timeoutMs = input.timeoutMs ?? 15_000;
  const maxBytes = input.maxBytes ?? 262_144;

  async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (input.apiKey) headers['authorization'] = `Bearer ${input.apiKey}`;
    let response: Response;
    try {
      response = await fetcher(`${ONECLICK_BASE_URL}${path}`, {
        method: init.method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      throw new OneClickHttpError('UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text().catch(() => '');
    if (text.length > maxBytes) throw new OneClickHttpError('UNAVAILABLE');
    let body: unknown = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = body !== null && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : '';
      throw new OneClickHttpError(classifyUpstreamError(response.status, message));
    }
    if (body === null) throw new OneClickHttpError('UNAVAILABLE');
    return body;
  }

  return {
    quote: (body) => call('/v0/quote', { method: 'POST', body }),
    status: (depositAddress, depositMemo) => {
      const q = new URLSearchParams({ depositAddress });
      if (depositMemo !== null) q.set('depositMemo', depositMemo);
      return call(`/v0/status?${q.toString()}`, { method: 'GET' });
    },
    tokens: () => call('/v0/tokens', { method: 'GET' }),
  };
}
