import assert from 'node:assert/strict';
import { createMockNearTestnetClient } from '../dist/testing.js';
import { TESTNET_GENESIS_HASH } from '../dist/index.js';

export const HASH = '11111111111111111111111111111111';
export const HASH2 = '11111111111111111111111111111112';
export const HASH3 = '11111111111111111111111111111113';
export const config = { network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org', rpcProviderId: 'testnet-public', contract: null };
export const status = { chain_id: 'testnet', genesis_hash: TESTNET_GENESIS_HASH,
  version: { version: '2.14.0-rc.5' }, sync_info: { syncing: false } };
export const block = { header: { hash: HASH, height: 123, timestamp_nanosec: '1793520000000000001' } };
export const account = { amount: '12345678901234567890123456789', locked: '0', storage_usage: 182,
  code_hash: HASH, block_hash: HASH, block_height: 123 };

export function mock(routes = {}, overrides = {}) {
  const calls = [];
  const client = createMockNearTestnetClient({ ...config, ...overrides }, {
    now: () => new Date('2026-10-29T12:00:00.000Z'),
    fetch: async (url, init) => {
      assert.equal(url, config.rpcUrl);
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      const request = JSON.parse(init.body);
      calls.push(request);
      const handler = routes[request.method];
      const result = handler ? await handler(request, init) : ({ status, block, query: account })[request.method];
      if (result instanceof Response) return result;
      if (result?.rpcError) return Response.json({ jsonrpc: '2.0', id: request.id, error: result.rpcError });
      assert.notEqual(result, undefined, `Unexpected RPC method ${request.method}`);
      return Response.json({ jsonrpc: '2.0', id: request.id, result });
    },
  });
  return { client, calls };
}
export function rpcError(name, code = -32000) {
  return { rpcError: { code, name: 'HANDLER_ERROR', cause: { name }, message: 'untrusted sensitive detail' } };
}
