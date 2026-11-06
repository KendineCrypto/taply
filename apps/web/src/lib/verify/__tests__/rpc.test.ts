import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { VerifierRpcError, assertSafeNumbers, createFetchVerifierRpc } from '../rpc';
import type { VerifierMethod } from '../rpc';

function respond(body: (request: { id: string }) => unknown, status = 200): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { id: string };
    return new Response(typeof body === 'function' ? JSON.stringify(body(request)) : '', { status });
  }) as typeof fetch;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return error instanceof VerifierRpcError ? error.code : 'other';
  }
}

describe('verifier RPC transport', () => {
  it('returns the result of a well-formed response', async () => {
    const rpc = createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher: respond(({ id }) => ({ jsonrpc: '2.0', id, result: { ok: 1 } })),
    });
    await expect(rpc.call('status', [])).resolves.toEqual({ ok: 1 });
  });

  it('sends no credentials, no cache and refuses redirects', async () => {
    let seen: RequestInit | undefined;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init;
      const { id } = JSON.parse(String(init?.body)) as { id: string };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: null }));
    }) as typeof fetch;
    await createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher,
    }).call('block', { finality: 'final' });
    expect(seen).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      method: 'POST',
    });
  });

  it.each([
    ['mismatched id', respond(() => ({ jsonrpc: '2.0', id: 'other', result: {} })), 'MALFORMED'],
    ['result and error', respond(({ id }) => ({ jsonrpc: '2.0', id, result: {}, error: {} })), 'MALFORMED'],
    ['fractional number', respond(({ id }) => ({ jsonrpc: '2.0', id, result: { n: 1.5 } })), 'MALFORMED'],
    [
      'unknown transaction',
      respond(({ id }) => ({
        jsonrpc: '2.0',
        id,
        error: { cause: { name: 'UNKNOWN_TRANSACTION' } },
      })),
      'UNKNOWN_TRANSACTION',
    ],
    [
      'pruned block',
      respond(({ id }) => ({
        jsonrpc: '2.0',
        id,
        error: { cause: { name: 'GARBAGE_COLLECTED_BLOCK' } },
      })),
      'UNKNOWN_BLOCK',
    ],
    [
      'other rpc error',
      respond(({ id }) => ({
        jsonrpc: '2.0',
        id,
        error: { name: 'HANDLER_ERROR' },
      })),
      'RPC_ERROR',
    ],
    ['http 429', respond(() => ({}), 429), 'RPC_UNAVAILABLE'],
  ])('maps %s', async (_label, fetcher, expected) => {
    const rpc = createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher,
    });
    expect(await codeOf(rpc.call('status', []))).toBe(expected);
  });

  it('maps a network failure to RPC_UNAVAILABLE', async () => {
    const fetcher = (async () => {
      throw new TypeError('network');
    }) as typeof fetch;
    const rpc = createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher,
    });
    expect(await codeOf(rpc.call('status', []))).toBe('RPC_UNAVAILABLE');
  });

  it('reads a genuine Testnet block without rounding its legacy numeric timestamp', async () => {
    const raw = readFileSync('src/lib/verify/__tests__/fixtures/testnet/final-block.json', 'utf8');
    const rpc = createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher: (async (_url, init) => {
        const { id } = JSON.parse(String(init?.body)) as { id: string };
        return new Response(raw.replace('"id":"pilot-check"', `"id":"${id}"`));
      }) as typeof fetch,
    });
    const block = await rpc.call('block', { finality: 'final' }) as {
      header: { height: number; timestamp: bigint; timestamp_nanosec: string };
    };
    expect(block.header.height).toBe(275747769);
    expect(block.header.timestamp).toBe(1793535606670615924n);
    expect(block.header.timestamp_nanosec).toBe('1793535606670615924');
  });

  it('rejects duplicate JSON fields before their values can be overwritten', async () => {
    const rpc = createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher: (async (_url, init) => {
        const { id } = JSON.parse(String(init?.body)) as { id: string };
        return new Response(`{"jsonrpc":"2.0","id":"${id}","result":{"n":1,"n":2}}`);
      }) as typeof fetch,
    });
    expect(await codeOf(rpc.call('status', []))).toBe('MALFORMED');
  });

  it('refuses any method outside the read-only allowlist', async () => {
    const rpc = createFetchVerifierRpc({
      rpcUrl: 'https://rpc.example',
      providerId: 'p',
      fetcher: respond(({ id }) => ({ jsonrpc: '2.0', id, result: {} })),
    });
    expect(await codeOf(rpc.call('send_tx' as VerifierMethod, {}))).toBe('RPC_ERROR');
    expect(await codeOf(rpc.call('broadcast_tx_commit' as VerifierMethod, {}))).toBe('RPC_ERROR');
  });

  it('assertSafeNumbers accepts strings and safe integers', () => {
    expect(() =>
      assertSafeNumbers({
        a: '340282366920938463463374607431768211455',
        b: [1, 2, { c: 3 }],
      }),
    ).not.toThrow();
  });
});
