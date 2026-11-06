import { describe, expect, it } from 'vitest';
import { VerifierRpcError, createFetchVerifierRpc } from '../rpc';

/**
 * Phase 5C: the independent verifier's transport must bound the response body
 * (in bytes, while streaming) and time out on a hanging body, before anything
 * is parsed. Transport failures stay transient (RPC_UNAVAILABLE); only size and
 * encoding problems are MALFORMED (which the verifier treats as a mismatch).
 */

const encoder = new TextEncoder();

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return error instanceof VerifierRpcError ? error.code : 'other';
  }
}

/** Streams `chunks`, then either ends or hangs forever. Counts pulls and cancellation. */
function streamingFetch(
  makeChunks: (id: string) => ReadonlyArray<Uint8Array>,
  options: { readonly hang?: boolean; readonly failAfter?: number; readonly headers?: Record<string, string> } = {},
) {
  const stats = { pulls: 0, cancelled: false, aborted: false };
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const { id } = JSON.parse(String(init?.body)) as { id: string };
    init?.signal?.addEventListener('abort', () => {
      stats.aborted = true;
    });
    const chunks = [...makeChunks(id)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        stats.pulls += 1;
        if (options.failAfter !== undefined && stats.pulls > options.failAfter) {
          controller.error(new TypeError('network error'));
          return;
        }
        const next = chunks.shift();
        if (next !== undefined) {
          controller.enqueue(next);
          return;
        }
        if (options.hang === true) return new Promise<void>(() => undefined); // never settles
        controller.close();
      },
      cancel() {
        stats.cancelled = true;
      },
    });
    return new Response(body, { status: 200, headers: options.headers ?? {} });
  }) as typeof fetch;
  return { fetcher, stats };
}

const envelope = (id: string, result: unknown) => encoder.encode(JSON.stringify({ jsonrpc: '2.0', id, result }));

describe('verifier RPC: bounded streaming and timeouts', () => {
  it('times out a response whose body never finishes, and cancels it', async () => {
    const { fetcher, stats } = streamingFetch((id) => [encoder.encode(`{"jsonrpc":"2.0","id":"${id}","result":`)], { hang: true });
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher, timeoutMs: 40 });
    expect(await codeOf(rpc.call('status', []))).toBe('RPC_UNAVAILABLE');
    expect(stats.aborted).toBe(true);
    expect(stats.cancelled).toBe(true);
  });

  it('times out even when fetch ignores the abort signal', async () => {
    const fetcher = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher, timeoutMs: 30 });
    expect(await codeOf(rpc.call('block', { finality: 'final' }))).toBe('RPC_UNAVAILABLE');
  });

  it('stops reading as soon as a streamed body crosses the byte limit', async () => {
    const kib = new Uint8Array(1024).fill(0x20);
    const { fetcher, stats } = streamingFetch(() => Array.from({ length: 50 }, () => kib));
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher, maxResponseBytes: 4096 });
    expect(await codeOf(rpc.call('status', []))).toBe('MALFORMED');
    // 4 KiB allowed, the 5th chunk crosses it: no further pulls.
    expect(stats.pulls).toBeLessThanOrEqual(6);
    expect(stats.cancelled).toBe(true);
  });

  it('refuses a declared Content-Length over the limit without reading the body', async () => {
    const { fetcher, stats } = streamingFetch((id) => [envelope(id, null)], { headers: { 'content-length': '999999' } });
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher, maxResponseBytes: 1000 });
    expect(await codeOf(rpc.call('status', []))).toBe('MALFORMED');
    expect(stats.pulls).toBeLessThanOrEqual(1);
  });

  it('counts UTF-8 bytes, not characters', async () => {
    // Each "é" is 2 bytes. The text has fewer CHARACTERS than the limit but more BYTES.
    const make = (id: string) => [envelope(id, { memo: 'é'.repeat(300) })];
    const size = make('taply-verify-1')[0]!.byteLength;
    const chars = new TextDecoder().decode(make('taply-verify-1')[0]).length;
    expect(chars).toBeLessThan(size);
    const between = chars + Math.floor((size - chars) / 2);
    const tight = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher: streamingFetch(make).fetcher, maxResponseBytes: between });
    expect(await codeOf(tight.call('status', []))).toBe('MALFORMED');
    const exact = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher: streamingFetch(make).fetcher, maxResponseBytes: size });
    await expect(exact.call('status', [])).resolves.toEqual({ memo: 'é'.repeat(300) });
  });

  it('decodes a multi-byte character split across chunks', async () => {
    const make = (id: string) => {
      const bytes = envelope(id, { name: 'Gören ✓' });
      const cut = bytes.indexOf(0xc3) + 1; // split inside "ö"
      return [bytes.slice(0, cut), bytes.slice(cut)];
    };
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher: streamingFetch(make).fetcher });
    await expect(rpc.call('status', [])).resolves.toEqual({ name: 'Gören ✓' });
  });

  it('treats invalid UTF-8 as malformed, never as replacement characters', async () => {
    const make = (id: string) => {
      const head = encoder.encode(`{"jsonrpc":"2.0","id":"${id}","result":"`);
      return [head, new Uint8Array([0xff, 0xfe]), encoder.encode('"}')];
    };
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher: streamingFetch(make).fetcher });
    expect(await codeOf(rpc.call('status', []))).toBe('MALFORMED');
  });

  it('keeps a connection drop mid-body transient (RPC_UNAVAILABLE), not a mismatch', async () => {
    const { fetcher } = streamingFetch((id) => [encoder.encode(`{"jsonrpc":"2.0","id":"${id}",`), encoder.encode('"result":1}')], { failAfter: 1 });
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher });
    expect(await codeOf(rpc.call('status', []))).toBe('RPC_UNAVAILABLE');
  });

  it('still maps HTTP errors to RPC_UNAVAILABLE', async () => {
    const fetcher = (async () => new Response('busy', { status: 429 })) as typeof fetch;
    const rpc = createFetchVerifierRpc({ rpcUrl: 'https://rpc.example', providerId: 'p', fetcher });
    expect(await codeOf(rpc.call('status', []))).toBe('RPC_UNAVAILABLE');
  });
});
