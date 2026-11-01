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
 * JSON.parse silently rounds integers above 2^53. Every integer the verifier
 * relies on (heights, gas, nonces) is below that on NEAR, so anything larger or
 * fractional is rejected rather than read with lost precision. Amounts and
 * timestamps arrive as strings and are untouched.
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

export function createFetchVerifierRpc(input: {
  readonly rpcUrl: string;
  readonly providerId: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
}): VerifierRpc {
  const fetcher = input.fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = input.timeoutMs ?? 15_000;
  let nextId = 0;
  return {
    providerId: input.providerId,
    async call(method, params) {
      if (!VERIFIER_METHODS.includes(method)) throw new VerifierRpcError('RPC_ERROR');
      const id = `taply-verify-${++nextId}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let text: string;
      try {
        const response = await fetcher(input.rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        });
        if (!response.ok) throw new VerifierRpcError('RPC_UNAVAILABLE');
        text = await response.text();
      } catch (error) {
        if (error instanceof VerifierRpcError) throw error;
        throw new VerifierRpcError('RPC_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
      if (text.length > MAX_RESPONSE_BYTES) throw new VerifierRpcError('MALFORMED');
      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new VerifierRpcError('MALFORMED');
      }
      if (typeof envelope !== 'object' || envelope === null) throw new VerifierRpcError('MALFORMED');
      const record = envelope as Record<string, unknown>;
      if (record['jsonrpc'] !== '2.0' || record['id'] !== id) throw new VerifierRpcError('MALFORMED');
      const hasResult = Object.hasOwn(record, 'result');
      const hasError = Object.hasOwn(record, 'error');
      if (hasResult === hasError) throw new VerifierRpcError('MALFORMED');
      if (hasError) throw new VerifierRpcError(classifyRpcError(record['error']));
      const result = record['result'];
      assertSafeNumbers(result);
      return result;
    },
  };
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
