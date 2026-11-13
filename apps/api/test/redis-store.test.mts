import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { RedisDurableStore, upstashCommand, sessionKeyFromEnv, type RedisCommand } from '../src/redis-store.mts';
import {createMainnetGlobalRedisStore} from '../src/mainnet-wallet-store.mts';

// Real Redis semantics (EVAL/Lua, PX TTL) through a local redis-server; skipped only if absent.
const hasRedis = spawnSync('redis-server', ['--version']).status === 0;

/** Minimal RESP2 client: one TCP socket, replies matched in order. */
function resp(port: number): { command: RedisCommand; close: () => void } {
  const socket = connect(port, '127.0.0.1');
  let buf = Buffer.alloc(0);
  const waiting: Array<(v: unknown) => void> = [];
  // A refused or dropped connection must reject every pending reply, never hang.
  socket.on('error', (e) => { while (waiting.length > 0) waiting.shift()?.(e); });
  const parse = (b: Buffer, i: number): [unknown, number] | null => {
    const end = b.indexOf('\r\n', i);
    if (end < 0) return null;
    const type = String.fromCharCode(b[i] ?? 0);
    const line = b.toString('utf8', i + 1, end);
    if (type === '+') return [line, end + 2];
    if (type === '-') return [new Error(line), end + 2];
    if (type === ':') return [Number(line), end + 2];
    if (type === '$') {
      const n = Number(line);
      if (n < 0) return [null, end + 2];
      if (b.length < end + 4 + n) return null;
      return [b.toString('utf8', end + 2, end + 2 + n), end + 4 + n];
    }
    if (type === '*') {
      const out: unknown[] = [];
      let j = end + 2;
      for (let k = 0; k < Number(line); k++) {
        const r = parse(b, j);
        if (!r) return null;
        out.push(r[0]);
        j = r[1];
      }
      return [out, j];
    }
    throw Error('bad resp');
  };
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const r = parse(buf, 0);
      if (!r) break;
      buf = buf.subarray(r[1]);
      waiting.shift()?.(r[0]);
    }
  });
  return {
    command: (args) => new Promise((res, rej) => {
      if (socket.destroyed) { rej(Error('closed')); return; }
      waiting.push((v) => (v instanceof Error ? rej(v) : res(v)));
      socket.write(`*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`);
    }),
    close: () => socket.destroy(),
  };
}

async function withRedis(fn: (port: number) => Promise<void>): Promise<void> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        const c = resp(port);
        await c.command(['PING']);
        c.close();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await fn(port);
  } finally {
    server.kill();
  }
}

const store = (command: RedisCommand, key: Uint8Array = randomBytes(32), ttlMs = 60_000) =>
  new RedisDurableStore<{ n: number }>({ command, key, namespace: 'handshake-test', initial: () => ({ n: 0 }), ttlMs });

test('real Redis Mainnet wallet authority: atomic reservation, no TTL, reconnect persistence and account isolation', {skip:!hasRedis}, async()=>{
  await withRedis(async port=>{
    const clients=Array.from({length:4},()=>resp(port));
    try{
      const stores=clients.map(c=>createMainnetGlobalRedisStore(c.command,'alice.near'));
      const next=JSON.stringify({version:2,network:'near-mainnet',accountId:'alice.near',pending:'fixture'});
      const wins=await Promise.all(Array.from({length:20},(_,i)=>stores[i%4]!.compareAndSwap('alice.near',null,next)));
      assert.equal(wins.filter(Boolean).length,1);
      assert.equal(await clients[0]!.command(['PTTL','taply:mainnet:wallet:v2:alice.near']),-1);
      const restart=resp(port);try{assert.equal(await createMainnetGlobalRedisStore(restart.command,'alice.near').read('alice.near'),next);}finally{restart.close();}
      await assert.rejects(stores[0]!.read('bob.near'),/UNAUTHORIZED/);
      assert.equal(await stores[1]!.compareAndSwap('alice.near',null,next),false);
      await clients[0]!.command(['PEXPIRE','taply:mainnet:wallet:v2:alice.near','60000']);
      await assert.rejects(stores[0]!.compareAndSwap('alice.near',next,next),/DURABILITY/);
    }finally{clients.forEach(c=>c.close());}
  });
});

test('real redis: 50 concurrent increments from 5 independent clients lose nothing (atomic CAS)', { skip: !hasRedis }, async () => {
  await withRedis(async (port) => {
    const key = randomBytes(32);
    const clients = Array.from({ length: 5 }, () => resp(port));
    const stores = clients.map((c) => store(c.command, key));
    await Promise.all(Array.from({ length: 50 }, (_, i) =>
      stores[i % 5]!.transaction('room:a', (s) => { s.n += 1; return s.n; }, 200)));
    assert.equal((await stores[0]!.read('room:a'))?.n, 50);
    clients.forEach((c) => c.close());
  });
});

test('real redis: wrong key, moved blob, tampering and missing version fail closed; TTL applied', { skip: !hasRedis }, async () => {
  await withRedis(async (port) => {
    const c = resp(port);
    const s = store(c.command, randomBytes(32), 5_000);
    await s.transaction('room:b', (st) => { st.n = 7; });
    const raw = String(await c.command(['GET', 'taply:handshake-test:room:b']));
    assert.ok(Number(await c.command(['PTTL', 'taply:handshake-test:room:b'])) > 0);
    await assert.rejects(store(c.command).read('room:b'), /VERIFICATION_UNAVAILABLE/);
    await c.command(['SET', 'taply:handshake-test:room:c', raw]);
    await c.command(['SET', 'taply:handshake-test:room:c:v', '1']);
    await assert.rejects(s.read('room:c'), /VERIFICATION_UNAVAILABLE/, 'a blob copied to another record must not decrypt');
    await c.command(['SET', 'taply:handshake-test:room:b', `${raw.slice(0, -8)}AAAAAAA=`]);
    await assert.rejects(s.transaction('room:b', (st) => st.n), /VERIFICATION_UNAVAILABLE/);
    await c.command(['SET', 'taply:handshake-test:room:b', raw]);
    await c.command(['DEL', 'taply:handshake-test:room:b:v']);
    await assert.rejects(s.transaction('room:b', (st) => st.n), /VERIFICATION_UNAVAILABLE/, 'value without version is corruption');
    c.close();
  });
});

test('transport outage fails closed; persistent contention gives up without writing', async () => {
  const down: RedisCommand = async () => { throw Error('ECONNRESET'); };
  await assert.rejects(store(down).transaction('room:x', (s) => s.n), /VERIFICATION_UNAVAILABLE/);
  let evals = 0;
  const contended: RedisCommand = async (args) => {
    if (args[0] === 'EVAL') { evals++; return 0; }
    return [null, null];
  };
  await assert.rejects(store(contended).transaction('room:y', (s) => s.n, 3), /RATE_LIMITED/);
  assert.equal(evals, 3);
});

test('config: Upstash REST needs https URL + token; session key must be 32 bytes base64', async () => {
  assert.throws(() => upstashCommand({}), /VERIFICATION_UNAVAILABLE/);
  assert.throws(() => upstashCommand({ KV_REST_API_URL: 'http://x', KV_REST_API_TOKEN: 't' }), /VERIFICATION_UNAVAILABLE/);
  const calls: Array<{ url: string; auth: string | null; body: string }> = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get('authorization'), body: String(init.body) });
    return new Response(JSON.stringify({ result: 'OK' }));
  }) as unknown as typeof fetch;
  const cmd = upstashCommand({ KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_TOKEN: 'tok' }, fake);
  assert.equal(await cmd(['SET', 'a', 'b']), 'OK');
  assert.deepEqual(calls[0], { url: 'https://example.upstash.io', auth: 'Bearer tok', body: '["SET","a","b"]' });
  const failing = upstashCommand({ KV_REST_API_URL: 'https://e.io', KV_REST_API_TOKEN: 't' },
    (async () => new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 401 })) as unknown as typeof fetch);
  await assert.rejects(failing(['GET', 'a']), /REDIS_ERROR/);
  assert.throws(() => sessionKeyFromEnv({ TAPLY_SESSION_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }), /VERIFICATION_UNAVAILABLE/);
  assert.equal(sessionKeyFromEnv({ TAPLY_SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64') }).byteLength, 32);
});
