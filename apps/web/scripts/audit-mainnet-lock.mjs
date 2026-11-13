// Historical entry point, now a durable-reservation regression (no real Redis).
import assert from 'node:assert/strict';
import { memoryQuoteStore } from '../src/server/mainnet/oneclick/store.ts';
const store = memoryQuoteStore();
const requestId = 'a'.repeat(64);
const first = await store.reserve({ id: 'first', requestId, mode: 'funded', payload: '{}', createdAtMs: 0 }, null);
assert.equal(typeof first, 'object');
const second = await store.reserve({ id: 'second', requestId, mode: 'funded', payload: '{}', createdAtMs: 30001 }, first.id);
assert.equal(second, 'BUSY');
console.log(JSON.stringify({ kind: 'DURABLE_RESERVATION_REGRESSION', second, realRedisUsed: false, fundedQuotesEnabled: false }));
