import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommerceService } from '../src/service.mts';
import { createCoordinationReader } from '../../web/src/lib/handshake/http-reader.ts';

const ORIGIN = 'https://taply.example';
const ID = '12345678-1234-4234-8234-123456789012';

// Synthetic in-process HTTP only. Dedicated disposable service key, no wallet.
test('reads actual production refusal without activating auth or exposing cookies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taply-7e-'));
    const service = createCommerceService(join(dir, 'test.sqlite'), new Uint8Array(32).fill(7), ORIGIN, true);
    const calls: Request[] = [];
    const transport: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return service.handle(request, 'integration-test');
    };
    try {
      const reader = createCoordinationReader(ORIGIN, transport);
      assert.deepEqual(await reader.snapshot(ID), { ok: false, error: 'unavailable' });
      assert.deepEqual(await reader.events(ID, '3'), { ok: false, error: 'unavailable' });
      assert.deepEqual(calls.map(r => r.method), ['GET', 'GET']);
      assert.equal(calls[1]?.headers.get('last-event-id'), '3');
      assert.ok(calls.every(r => r.credentials === 'same-origin' && r.cache === 'no-store' && r.redirect === 'error'));
      assert.ok(calls.every(r => !r.headers.has('cookie') && new URL(r.url).search === ''));
      const auth = await service.handle(new Request(`${ORIGIN}/api/v1/auth/challenges`, {
        method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{"accountId":"merchant.testnet"}',
      }), 'integration-test');
      assert.equal(auth.status, 503);
      assert.equal(auth.headers.has('set-cookie'), false);
    } finally { service.close(); rmSync(dir, { recursive: true }); }
  });
