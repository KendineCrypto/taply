/**
 * Minimal Upstash Redis REST client (server only). One JSON command per POST,
 * Bearer token, no redirects, bounded time. Errors throw; there is no fallback
 * store: without Redis the live session is reported unavailable.
 */
export type RedisCommand = (args: ReadonlyArray<string | number>) => Promise<unknown>;

export function restRedis(input: { url: string; token: string; fetcher?: typeof fetch; timeoutMs?: number }): RedisCommand {
  const fetcher = input.fetcher ?? ((u, i) => globalThis.fetch(u, i));
  const url = input.url.replace(/\/+$/, '');
  return async (args) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 5_000);
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${input.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(args.map(String)),
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      if (!response.ok || body.error !== undefined) throw new Error('REDIS_ERROR');
      return body.result ?? null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Upstash (Vercel Marketplace) sets either KV_* or UPSTASH_REDIS_REST_* variables. */
export function redisFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): RedisCommand | null {
  const url = env['KV_REST_API_URL'] ?? env['UPSTASH_REDIS_REST_URL'];
  const token = env['KV_REST_API_TOKEN'] ?? env['UPSTASH_REDIS_REST_TOKEN'];
  if (!url || !token || !/^https:\/\//.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) return null;
  return restRedis({ url, token });
}
