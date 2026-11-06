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
  /** Network failure, HTTP error or rate limit. Try again later. */
  | 'RPC_UNAVAILABLE'
  /** The node does not know this transaction (yet). */
  | 'UNKNOWN_TRANSACTION'
  /** The node no longer has (or never had) this block: an archival RPC is needed. */
  | 'UNKNOWN_BLOCK'
  /** Any other RPC-level error. */
  | 'RPC_ERROR'
  /** The response was not valid JSON-RPC or broke a size/number rule. */
  | 'MALFORMED';

export class VerifierRpcError extends Error {
  constructor(readonly code: VerifierRpcErrorCode) {
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
  let nextId = 0;
  return {
    providerId: input.providerId,
    async call(method, params) {
      if (!allowed.includes(method)) throw new VerifierRpcError('RPC_ERROR');
      const id = `${idPrefix}-${++nextId}`;
      const { text, httpOk } = await fetchBoundedText({
        fetcher,
        url: input.rpcUrl,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        timeoutMs,
        maxBytes,
        errorBodyStatuses: ERROR_BODY_STATUSES,
      });
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
      const result = record['result'];
      assertSafeNumbers(result);
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
