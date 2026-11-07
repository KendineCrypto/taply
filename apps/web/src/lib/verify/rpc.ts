import { parseRpcJsonWithIntegers } from '@taply/near-client';

/**
 * Read-only JSON-RPC transport for the receipt verifier.
 *
 * Why not `@taply/near-client`? Its transaction reader keeps outcomes but drops
 * receipt payloads (predecessor, receiver, actions, data dependencies), and the
 * verifier needs exactly those. near-client is owned by the core team, so this
 * small transport lives in apps/web instead of editing a shared package.
 *
 * It can only read: the allowed methods are `status`, `block`, `query` and
 * `EXPERIMENTAL_tx_status`. It never sends a transaction and holds no keys.
 */

export const VERIFIER_METHODS = ['status', 'block', 'query', 'EXPERIMENTAL_tx_status'] as const;
export type VerifierMethod = (typeof VERIFIER_METHODS)[number];

export type VerifierRpcErrorCode =
  /** Network failure, HTTP error or timeout. Try again later. */
  | 'RPC_UNAVAILABLE'
  /**
   * The provider answered HTTP 429, or this tab is still inside the cool-down
   * it asked for. Nothing was learned about the chain. Wait `retryAfterMs`.
   */
  | 'RATE_LIMITED'
  /** The node does not know this transaction (yet). */
  | 'UNKNOWN_TRANSACTION'
  /** The node no longer has (or never had) this block: an archival RPC is needed. */
  | 'UNKNOWN_BLOCK'
  /** Any other RPC-level error. */
  | 'RPC_ERROR'
  /** The response was not valid JSON-RPC or broke a size/number rule. */
  | 'MALFORMED';

export class VerifierRpcError extends Error {
  constructor(
    readonly code: VerifierRpcErrorCode,
    /** Set for RATE_LIMITED (and a 503 with Retry-After): how long the provider asked us to wait. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(`verifier-rpc:${code}`);
    this.name = 'VerifierRpcError';
  }
}

export interface VerifierRpc {
  readonly providerId: string;
  call(method: VerifierMethod, params: unknown): Promise<unknown>;
}

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Used numeric fields (heights, gas, nonces) must be safe integers. The lossless
 * parser preserves larger tokens as bigint, which the field schemas reject if
 * used. This allows unused legacy block.header.timestamp without rounding it;
 * verification uses the exact string block.header.timestamp_nanosec instead.
 */
export function assertSafeNumbers(value: unknown, depth = 0): void {
  if (depth > 64) throw new VerifierRpcError('MALFORMED');
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new VerifierRpcError('MALFORMED');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeNumbers(item, depth + 1);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) assertSafeNumbers(item, depth + 1);
  }
}

const UNKNOWN_BLOCK_NAMES = new Set(['UNKNOWN_BLOCK', 'GARBAGE_COLLECTED_BLOCK', 'UNKNOWN_CHUNK']);

export interface FetchRpcInput {
  readonly rpcUrl: string;
  readonly providerId: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetcher?: typeof fetch;
  /**
   * Shared cool-down for every reader of the same RPC. Pass the same gate to
   * the verifier and the locator; a fresh private gate is used otherwise.
   */
  readonly rateLimitGate?: RateLimitGate;
  /** Clock for Retry-After HTTP-dates. */
  readonly now?: () => number;
  /** Keep immutable answers in memory (default true). See `immutableCacheKey`. */
  readonly cacheImmutable?: boolean;
}

/** Bounded in-memory cache size per transport. */
export const IMMUTABLE_CACHE_ENTRIES = 512;

// NEAR block, chunk and transaction hashes are base58, 32 bytes.
const BASE58_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Returns a cache key only for requests whose successful answer can never
 * change: a block or chunk named by hash, a state query pinned to a block hash,
 * and a transaction status requested at FINAL (the result is additionally
 * checked to be FINAL before it is kept). Latest-final reads, `status`, block
 * heights and anything else are never cached.
 *
 * This is a same-tab, same-provider memory of answers already received from
 * the chain in this session, so a retry after a 429 only asks for what is still
 * missing. It is never written to storage and never replaces a fresh read of
 * the current contract state.
 */
export function immutableCacheKey(method: string, params: unknown): string | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const p = params as Record<string, unknown>;
  const pinnedByHash = typeof p['block_id'] === 'string' && BASE58_HASH.test(p['block_id']) && !('finality' in p);
  if (method === 'block' && pinnedByHash && Object.keys(p).length === 1) return `${method}:${JSON.stringify(p)}`;
  if (method === 'chunk' && typeof p['chunk_id'] === 'string' && BASE58_HASH.test(p['chunk_id']) && Object.keys(p).length === 1) {
    return `${method}:${JSON.stringify(p)}`;
  }
  if (method === 'query' && pinnedByHash) return `${method}:${stableJson(p)}`;
  if (
    method === 'EXPERIMENTAL_tx_status' &&
    p['wait_until'] === 'FINAL' &&
    typeof p['tx_hash'] === 'string' &&
    BASE58_HASH.test(p['tx_hash'])
  ) {
    return `${method}:${stableJson(p)}`;
  }
  return null;
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
}

function cacheableResult(method: string, result: unknown): boolean {
  if (method !== 'EXPERIMENTAL_tx_status') return result !== null && result !== undefined;
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as Record<string, unknown>)['final_execution_status'] === 'FINAL'
  );
}

export function createFetchVerifierRpc(input: FetchRpcInput): VerifierRpc {
  return createBoundedRpc(VERIFIER_METHODS, 'taply-verify', input);
}

/**
 * Phase 7G: read-only transport for the funding-transaction locator
 * (`locate-funding.ts`). Its own allowlist, `block` and `chunk` only, so the
 * verifier's allowlist above stays exactly as reviewed. Same bounded transport.
 */
export const LOCATOR_METHODS = ['block', 'chunk'] as const;
export type LocatorMethod = (typeof LOCATOR_METHODS)[number];

export interface LocatorRpc {
  readonly providerId: string;
  call(method: LocatorMethod, params: unknown): Promise<unknown>;
}

export function createFetchLocatorRpc(input: FetchRpcInput): LocatorRpc {
  return createBoundedRpc(LOCATOR_METHODS, 'taply-locate', input);
}

// FastNEAR can return structured missing-history errors with HTTP 422.
// Read bounded errors for both consumers, but never accept non-2xx results.
// HTTP 408/TIMEOUT_ERROR alone is uncertain, not evidence of pruned history.
const ERROR_BODY_STATUSES: ReadonlySet<number> = new Set([400, 404, 408, 422, 500]);

function createBoundedRpc<M extends string>(
  allowed: ReadonlyArray<M>,
  idPrefix: string,
  input: FetchRpcInput,
): { readonly providerId: string; call(method: M, params: unknown): Promise<unknown> } {
  const fetcher = input.fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = input.timeoutMs ?? 15_000;
  const maxBytes = input.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  const now = input.now ?? (() => Date.now());
  const gate = input.rateLimitGate ?? createRateLimitGate(now);
  const cache = input.cacheImmutable === false ? null : new Map<string, unknown>();
  let nextId = 0;
  return {
    providerId: input.providerId,
    async call(method, params) {
      if (!allowed.includes(method)) throw new VerifierRpcError('RPC_ERROR');
      const cacheKey = cache === null ? null : immutableCacheKey(method, params);
      if (cacheKey !== null && cache?.has(cacheKey)) return structuredClone(cache.get(cacheKey));
      // Inside a provider-requested cool-down: fail at once, send nothing.
      const wait = gate.remainingMs();
      if (wait > 0) throw new VerifierRpcError('RATE_LIMITED', wait);
      // Backing off after opaque failures (possibly a 429 the browser hid): fail fast.
      if (gate.backoffRemainingMs() > 0) throw new VerifierRpcError('RPC_UNAVAILABLE');
      const id = `${idPrefix}-${++nextId}`;
      let fetched: { readonly text: string; readonly httpOk: boolean };
      try {
        fetched = await fetchBoundedText({
          fetcher,
          url: input.rpcUrl,
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          timeoutMs,
          maxBytes,
          errorBodyStatuses: ERROR_BODY_STATUSES,
          gate,
          now,
        });
      } catch (error) {
        if (error instanceof VerifierRpcError && error.code === 'RPC_UNAVAILABLE' && error.retryAfterMs === null) {
          gate.noteNetworkFailure();
        }
        throw error;
      }
      const { text, httpOk } = fetched;
      let envelope: unknown;
      try {
        envelope = parseRpcJsonWithIntegers(text);
      } catch {
        throw new VerifierRpcError(httpOk ? 'MALFORMED' : 'RPC_UNAVAILABLE');
      }
      const invalidEnvelope = httpOk ? 'MALFORMED' : 'RPC_UNAVAILABLE';
      if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) throw new VerifierRpcError(invalidEnvelope);
      const record = envelope as Record<string, unknown>;
      if (record['jsonrpc'] !== '2.0' || record['id'] !== id) throw new VerifierRpcError(invalidEnvelope);
      const hasResult = Object.hasOwn(record, 'result');
      const hasError = Object.hasOwn(record, 'error');
      if (hasResult === hasError) throw new VerifierRpcError(invalidEnvelope);
      if (!httpOk) {
        if (!hasError) throw new VerifierRpcError('RPC_UNAVAILABLE');
        const error = record['error'];
        if (typeof error !== 'object' || error === null || Array.isArray(error)) throw new VerifierRpcError('RPC_UNAVAILABLE');
        const detail = error as Record<string, unknown>;
        if (typeof detail['code'] !== 'number' || !Number.isSafeInteger(detail['code'])) throw new VerifierRpcError('RPC_UNAVAILABLE');
        const cause = detail['cause'];
        if (cause !== undefined && (typeof cause !== 'object' || cause === null || Array.isArray(cause)
          || typeof (cause as Record<string, unknown>)['name'] !== 'string')) throw new VerifierRpcError('RPC_UNAVAILABLE');
        const code = classifyRpcError(error);
        throw new VerifierRpcError(code === 'UNKNOWN_BLOCK' || code === 'UNKNOWN_TRANSACTION' ? code : 'RPC_UNAVAILABLE');
      }
      if (hasError) throw new VerifierRpcError(classifyRpcError(record['error']));
      gate.noteSuccess();
      const result = record['result'];
      assertSafeNumbers(result);
      if (cache !== null && cacheKey !== null && cacheableResult(method, result)) {
        if (cache.size >= IMMUTABLE_CACHE_ENTRIES) {
          const oldest = cache.keys().next();
          if (oldest.done !== true) cache.delete(oldest.value);
        }
        cache.set(cacheKey, structuredClone(result));
      }
      return result;
    },
  };
}

/**
 * POSTs and reads the response body with hard limits, mirroring near-client's
 * read transport:
 *  - one wall-clock timeout covers headers AND the whole body; it aborts the
 *    request and cancels the body reader, and is raced so a fetch that ignores
 *    the abort signal still cannot hang the verifier;
 *  - a declared Content-Length over the limit is refused before reading;
 *  - the body is streamed and counted in BYTES (not UTF-16 characters), and
 *    reading stops as soon as the limit is crossed;
 *  - invalid UTF-8 is malformed, never silently replaced.
 * Network/HTTP/timeout problems are RPC_UNAVAILABLE; size and encoding are MALFORMED.
 */
async function fetchBoundedText(input: {
  readonly fetcher: typeof fetch;
  readonly url: string;
  readonly body: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  /** HTTP error statuses whose (bounded) body is still read, for JSON-RPC error classification. */
  readonly errorBodyStatuses?: ReadonlySet<number>;
  readonly gate?: RateLimitGate;
  readonly now?: () => number;
}): Promise<{ readonly text: string; readonly httpOk: boolean }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new VerifierRpcError('RPC_UNAVAILABLE'));
    }, input.timeoutMs);
  });

  const work = async (): Promise<{ readonly text: string; readonly httpOk: boolean }> => {
    const response = await input.fetcher(input.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: input.body,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    // 429 Too Many Requests, or 503 with an explicit Retry-After: the provider
    // told us when to come back. Remember it for every reader of this RPC.
    const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'), (input.now ?? Date.now)());
    if (response.status === 429 || (response.status === 503 && retryAfter !== null)) {
      void response.body?.cancel().catch(() => undefined);
      const cooldown = clampCooldownMs(retryAfter);
      input.gate?.note(cooldown);
      throw new VerifierRpcError(response.status === 429 ? 'RATE_LIMITED' : 'RPC_UNAVAILABLE', cooldown);
    }
    if (!response.ok && !(input.errorBodyStatuses?.has(response.status) ?? false)) {
      void response.body?.cancel().catch(() => undefined);
      throw new VerifierRpcError('RPC_UNAVAILABLE');
    }
    const length = response.headers.get('content-length');
    if (length !== null && /^\d+$/.test(length) && BigInt(length) > BigInt(input.maxBytes)) {
      void response.body?.cancel().catch(() => undefined);
      throw new VerifierRpcError('MALFORMED');
    }
    if (response.body === null) throw new VerifierRpcError('MALFORMED');
    const reader = response.body.getReader();
    const cancelReader = () => {
      void reader.cancel().catch(() => undefined);
    };
    controller.signal.addEventListener('abort', cancelReader, { once: true });
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let bytes = 0;
    let text = '';
    // Decoding errors are MALFORMED; anything else while reading (connection
    // drop, abort) is RPC_UNAVAILABLE, which the verifier treats as transient.
    const decode = (bytesIn?: Uint8Array): string => {
      try {
        return bytesIn === undefined ? decoder.decode() : decoder.decode(bytesIn, { stream: true });
      } catch {
        throw new VerifierRpcError('MALFORMED');
      }
    };
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          throw new VerifierRpcError('RPC_UNAVAILABLE');
        }
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > input.maxBytes) throw new VerifierRpcError('MALFORMED');
        text += decode(chunk.value);
      }
      text += decode();
    } catch (error) {
      cancelReader();
      if (error instanceof VerifierRpcError) throw error;
      throw new VerifierRpcError('RPC_UNAVAILABLE');
    } finally {
      controller.signal.removeEventListener('abort', cancelReader);
      try {
        reader.releaseLock();
      } catch {
        // Already released by cancel in some engines.
      }
    }
    return { text, httpOk: response.ok };
  };

  try {
    return await Promise.race([work(), timeout]);
  } catch (error) {
    if (error instanceof VerifierRpcError) throw error;
    throw new VerifierRpcError('RPC_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

function classifyRpcError(error: unknown): VerifierRpcErrorCode {
  if (typeof error !== 'object' || error === null) return 'MALFORMED';
  const record = error as Record<string, unknown>;
  const cause = record['cause'];
  const causeName =
    typeof cause === 'object' && cause !== null ? (cause as Record<string, unknown>)['name'] : undefined;
  const name = typeof causeName === 'string' ? causeName : typeof record['name'] === 'string' ? record['name'] : '';
  if (name === 'UNKNOWN_TRANSACTION') return 'UNKNOWN_TRANSACTION';
  if (UNKNOWN_BLOCK_NAMES.has(name)) return 'UNKNOWN_BLOCK';
  if (name === 'TIMEOUT_ERROR') return 'RPC_UNAVAILABLE';
  return 'RPC_ERROR';
}

// ---------------------------------------------------------------------------
// Rate-limit gate. Kept in this file on purpose: packages/near-client's
// reproduce-instant-proof script loads rpc.ts + instant-receipt.ts as two
// standalone modules, so rpc.ts must not import other local files.
/**
 * Polite handling of public NEAR Testnet RPC rate limits (HTTP 429).
 *
 * Public RPCs throttle per IP. When one says "slow down", every reader that
 * shares this gate (the receipt verifier and the funding locator) stops calling
 * that RPC until the cool-down ends. Calls made during the cool-down fail at
 * once with RATE_LIMITED, without touching the network, so a retry button or a
 * second component cannot keep hammering a provider that already said no.
 *
 * The gate never produces chain data. It only ever turns calls into errors.
 */

/** Used when a 429 carries no usable Retry-After header. */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
/** Shortest cool-down we honour, so a `Retry-After: 0` storm cannot spin. */
export const MIN_RATE_LIMIT_COOLDOWN_MS = 2_000;
/**
 * Longest cool-down this tab keeps. A provider asking for longer (we saw
 * `Retry-After: 418`) is still respected for 10 minutes; after that one manual
 * "Check again" may try once more.
 */
export const MAX_RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;

/**
 * Parses an HTTP Retry-After value (delay-seconds or HTTP-date) into a delay in
 * milliseconds. Returns null for missing or unusable values. Never negative.
 */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // An HTTP header in whole seconds (at most 7 digits), not a chain amount.
  if (/^\d{1,7}$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000;
  // HTTP-date. Only accept something Date can parse to a real instant.
  if (!/[a-z]/i.test(trimmed)) return null;
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

export function clampCooldownMs(ms: number | null): number {
  const value = ms ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  return Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, value));
}

/**
 * Browsers hide many 429s: a provider that omits CORS headers on its 429 (we
 * saw this from archival-rpc.testnet.near.org) looks exactly like a network
 * error, and Retry-After is not a CORS-exposed header. So repeated opaque
 * failures also back off, doubling from 2 s to at most 60 s, and reset on the
 * first good answer. During that back-off calls fail fast as "unavailable"
 * (never as "rate limited", which we could not see).
 */
export const NETWORK_BACKOFF_START_MS = 2_000;
export const NETWORK_BACKOFF_MAX_MS = 60_000;

export interface RateLimitGate {
  /** Milliseconds left in the current provider-requested cool-down, or 0 when calls may go out. */
  remainingMs(): number;
  /** Milliseconds left in the back-off after opaque network failures, or 0. */
  backoffRemainingMs(): number;
  /** An opaque failure (network error, timeout, 5xx without Retry-After). */
  noteNetworkFailure(): void;
  /** A well-formed answer arrived: clears the network back-off (not a provider cool-down). */
  noteSuccess(): void;
  /** Epoch ms when the cool-down ends, or null when there is none. */
  blockedUntil(): number | null;
  /** Records a rate-limit answer. A later end time wins; an earlier one never shortens it. */
  note(cooldownMs: number): void;
  subscribe(listener: () => void): () => void;
}

export function createRateLimitGate(now: () => number = () => Date.now()): RateLimitGate {
  let until: number | null = null;
  let backoffUntil = 0;
  let failures = 0;
  const listeners = new Set<() => void>();
  const remaining = () => {
    if (until === null) return 0;
    const left = until - now();
    if (left <= 0) {
      until = null;
      return 0;
    }
    return left;
  };
  return {
    remainingMs: remaining,
    backoffRemainingMs: () => Math.max(0, backoffUntil - now()),
    noteNetworkFailure() {
      failures += 1;
      const delay = Math.min(NETWORK_BACKOFF_MAX_MS, NETWORK_BACKOFF_START_MS * 2 ** Math.min(failures - 1, 10));
      backoffUntil = Math.max(backoffUntil, now() + delay);
    },
    noteSuccess() {
      failures = 0;
      backoffUntil = 0;
    },
    blockedUntil: () => (remaining() > 0 ? until : null),
    note(cooldownMs) {
      const end = now() + clampCooldownMs(cooldownMs);
      if (until !== null && until >= end) return;
      until = end;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
