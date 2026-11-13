// Read-only, deterministic reproduction of the 30-second Redis lease issue.
// Models SET NX PX and compare/delete; no Redis, API, keys or funds are used.
import assert from 'node:assert/strict';
import { redisQuoteStore } from '../src/server/mainnet/oneclick/store.ts';
let now = 0;
const values = new Map();
const redis = async ([command, key, ...args]) => {
  if (command === 'SET') {
    const old = values.get(key);
    if (old && old.until > now) return null;
    values.set(key, { value: args[0], until: now + Number(args[3]) });
    return 'OK';
  }
  if (command === 'EVAL') {
    const lock = args[1];
    if (values.get(lock)?.value === args[2]) values.delete(lock);
    return 1;
  }
  throw new Error(`Unexpected command ${command}`);
};
let resume;
const paused = new Promise(resolve => { resume = resolve; });
const store = redisQuoteStore(redis);
let active = 0;
let peak = 0;
const first = store.withRequestLock('a'.repeat(64), async () => {
  peak = Math.max(peak, ++active);
  await paused;
  active--;
});
await Promise.resolve();
now = 30_001;
await store.withRequestLock('a'.repeat(64), async () => { peak = Math.max(peak, ++active); active--; });
resume();
await first;
assert.equal(peak, 2, 'Reassess this report if lease behavior changes');
console.log(JSON.stringify({ kind: 'KNOWN_BLOCKER_REPRODUCTION_NOT_SECURITY_PASS', simultaneousOwners: peak,
  realRedisUsed: false, fundedQuotesEnabled: false, conclusion: '30s expiry admits a second owner while the first is still active' }, null, 2));
