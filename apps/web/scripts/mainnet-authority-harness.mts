// TEST HARNESS ONLY — never deployed, never imported by the app.
//
// Runs Codex's real authenticated Mainnet authority stack (apps/api):
//   createMainnetAuthorityHttp → createAuthenticatedMainnetAuthority → createFencedMainnetRedisPersistence
// on a REAL redis-server, with an IN-MEMORY TEST WITNESS (FreshnessAuthority). The in-memory witness is
// NOT a production witness: it is not permanent, not linearizable across processes and shares this
// process's failure domain. It exists only so the integration can be exercised in isolation.
// Mainnet RPC is a SYNTHETIC chain served from the same process (shared by server and browser).
//
// Usage as a server (browser suite):  node apps/web/scripts/mainnet-authority-harness.mts <port> <redisPort>
//   POST /api/mainnet/authority/{challenge,execute}   Codex HTTP adapter (requests are re-addressed to
//                                                     https://mainnet.taplyapp.xyz, Origin preserved)
//   POST /__rpc                                        synthetic Mainnet JSON-RPC
//   POST /__harness/provision {accountId, publicKey}   provision Redis record + witness head (test setup)
//   POST /__harness/tx {hash, tx}                      add a FINAL transaction to the synthetic chain
//   POST /__harness/redis {args}                        raw Redis for TEST assertions (never reachable by the app)
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { canonicalJson } from '../../../packages/shared/dist/index.js';
import { MAINNET_GENESIS_HASH } from '../../../packages/near-client/dist/index.js';
import type { MainnetSigningProfiles } from '../../../packages/near-client/dist/index.js';
import { createAuthenticatedMainnetAuthority, initialMainnetAuthorityState } from '../../api/src/mainnet-authenticated-authority.mts';
import { createMainnetAuthorityHttp, createMainnetAuthorityRateLimiter } from '../../api/src/mainnet-authority-http.mts';
import { authorityAnchor, createFencedMainnetRedisPersistence } from '../../api/src/mainnet-authority-persistence.mts';
import type { AuthorityRecord } from '../../api/src/mainnet-authority-persistence.mts';
import type { FreshnessAnchor, FreshnessAuthority } from '../../api/src/freshness.mts';
import type { RedisCommand } from '../../api/src/redis-store.mts';

export const ORIGIN = 'https://mainnet.taplyapp.xyz';
export const BLOCK = '11111111111111111111111111111112';
export const CODE_HASH = 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf';
const nowNs = () => (BigInt(Date.now()) * 1_000_000n).toString();

/** Minimal RESP2 client (same approach as Codex's real-Redis tests). */
export function resp(port: number): { command: RedisCommand; close: () => void } {
  const socket = connect(port, '127.0.0.1');
  let buf = Buffer.alloc(0);
  const waiting: Array<(v: unknown) => void> = [];
  socket.on('error', (e) => { while (waiting.length > 0) waiting.shift()?.(e); });
  const parse = (b: Buffer, i: number): [unknown, number] | null => {
    const end = b.indexOf('\r\n', i);
    if (end < 0) return null;
    const type = String.fromCharCode(b[i] ?? 0), line = b.toString('utf8', i + 1, end);
    if (type === '+') return [line, end + 2];
    if (type === '-') return [new Error(line), end + 2];
    if (type === ':') return [Number(line), end + 2];
    if (type === '$') { const n = Number(line); if (n < 0) return [null, end + 2]; if (b.length < end + 4 + n) return null; return [b.toString('utf8', end + 2, end + 2 + n), end + 4 + n]; }
    if (type === '*') { const out: unknown[] = []; let j = end + 2; for (let k = 0; k < Number(line); k++) { const r = parse(b, j); if (!r) return null; out.push(r[0]); j = r[1]; } return [out, j]; }
    throw Error('bad resp');
  };
  socket.on('data', (d) => { buf = Buffer.concat([buf, d]); for (;;) { const r = parse(buf, 0); if (!r) break; buf = buf.subarray(r[1]); waiting.shift()?.(r[0]); } });
  return {
    command: (args) => new Promise((res, rej) => {
      if (socket.destroyed) { rej(Error('closed')); return; }
      waiting.push((v) => (v instanceof Error ? rej(v) : res(v)));
      socket.write(`*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`);
    }),
    close: () => socket.destroy(),
  };
}

/** IN-MEMORY TEST WITNESS. Not a production witness (see file header). */
export function testWitness(): FreshnessAuthority & { heads: Map<string, FreshnessAnchor> } {
  const heads = new Map<string, FreshnessAnchor>();
  return {
    heads,
    async read(scope) { const h = heads.get(scope); if (!h) throw Error('WITNESS_MISSING'); return structuredClone(h); },
    async compareAndSwap(scope, expected, next) {
      const h = heads.get(scope);
      if (!h || canonicalJson(h) !== canonicalJson(expected) || next.epoch !== h.epoch || BigInt(next.revision) !== BigInt(h.revision) + 1n) return false;
      heads.set(scope, structuredClone(next));
      return true;
    },
  };
}

/** SYNTHETIC Mainnet chain: genesis, a fresh final block, accounts, FullAccess keys and FINAL transactions. */
export function syntheticChain() {
  const keys = new Map<string, string>();
  const txs = new Map<string, unknown>();
  let nonce = 7;
  const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const q = JSON.parse(String(init?.body)), p = q.params ?? {};
    let result: unknown, error: unknown;
    if (q.method === 'status') result = { chain_id: 'mainnet', sync_info: { syncing: false } };
    else if (q.method === 'block') {
      if (p.block_id === 9820210) result = { header: { hash: MAINNET_GENESIS_HASH, height: 9820210, timestamp_nanosec: '1595350551591948000' } };
      else if (typeof p.block_id === 'string' && p.block_id !== BLOCK) result = { header: { hash: p.block_id, height: 199999999, timestamp_nanosec: nowNs() } };
      else result = { header: { hash: BLOCK, height: 200000000, timestamp_nanosec: nowNs() } };
    } else if (q.method === 'gas_price') result = { gas_price: '100000000' };
    else if (q.method === 'EXPERIMENTAL_protocol_config') result = { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
    else if (q.method === 'tx_status' || q.method === 'EXPERIMENTAL_tx_status') {
      const t = txs.get(p.tx_hash);
      if (t) result = t; else error = { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION', info: {} }, message: 'unknown tx' };
    } else if (p.request_type === 'view_account') result = { amount: '3000000000000000000000000', locked: '0', storage_usage: 182, code_hash: CODE_HASH, block_hash: BLOCK, block_height: 200000000 };
    else if (p.request_type === 'view_access_key') {
      if (keys.get(p.account_id) === p.public_key) result = { nonce, permission: 'FullAccess', block_hash: BLOCK, block_height: 200000000 };
      else error = { code: -32000, name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCESS_KEY', info: {} }, message: 'unknown key' };
    } else if (p.request_type === 'call_function') result = { result: Array.from(Buffer.from('null')), logs: [], block_hash: BLOCK, block_height: 200000000 };
    else error = { code: -32601, name: 'METHOD_NOT_FOUND', message: 'synthetic' };
    return new Response(JSON.stringify(error ? { jsonrpc: '2.0', id: q.id, error } : { jsonrpc: '2.0', id: q.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, addKey: (account: string, key: string) => keys.set(account, key), addTx: (hash: string, tx: unknown) => txs.set(hash, tx), setNonce: (n: number) => { nonce = n; } };
}

export function harnessProfiles(): MainnetSigningProfiles {
  const network = { network: 'near-mainnet' as const, rpcUrl: 'https://rpc.mainnet.fastnear.com' as const, rpcProviderId: 'fastnear-mainnet' };
  return { network, instant: { ...network, contract: { accountId: 'devkendinecrypto.near', expectedCodeHash: CODE_HASH } } };
}

async function nodeRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  return new Request(ORIGIN + (req.url ?? '/'), { method: req.method ?? 'GET', headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
}
async function send(res: ServerResponse, out: Response) {
  const headers: Record<string, string> = {};
  out.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}

/**
 * One Codex authority service per provisioned account (Codex's service is configured per account).
 * Routing: challenge → by publicKey; execute → by the challenge id it answers. That routing is HARNESS
 * glue; a multi-account production deployment needs a reviewed account router (open requirement).
 */
export async function startAuthorityHarness(input: { port: number; redisPort: number; profiles?: MainnetSigningProfiles; chain?: ReturnType<typeof syntheticChain> }) {
  const redis = resp(input.redisPort);
  const witness = testWitness();
  const chain = input.chain ?? syntheticChain();
  const profiles = input.profiles ?? harnessProfiles();
  const limiter = createMainnetAuthorityRateLimiter(redis.command);
  const byKey = new Map<string, string>();
  const handlers = new Map<string, ReturnType<typeof createMainnetAuthorityHttp>>();
  const challengeAccount = new Map<string, string>();
  let ipCounter = 0;
  async function provision(accountId: string, publicKey: string) {
    const record: AuthorityRecord = { epoch: randomBytes(32).toString('hex'), revision: '0', payload: initialMainnetAuthorityState(accountId) };
    await redis.command(['SET', `taply:mainnet:authority:v1:${accountId}`, canonicalJson(record)]);
    witness.heads.set(`taply.mainnet.authority:${accountId}`, authorityAnchor(accountId, record));
    chain.addKey(accountId, publicKey);
    byKey.set(publicKey, accountId);
    const persistence = createFencedMainnetRedisPersistence(redis.command, accountId, witness);
    const service = createAuthenticatedMainnetAuthority({ accountId, origin: ORIGIN, profiles, persistence }, chain.fetcher as typeof fetch);
    handlers.set(accountId, createMainnetAuthorityHttp(service, accountId, limiter));
  }
  const server = createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';
      if (url === '/__rpc') { const r = await nodeRequest(req); return void send(res, await chain.fetcher('', { method: 'POST', body: await r.text() })); }
      if (url === '/__harness/provision') { const b = await (await nodeRequest(req)).json(); await provision(b.accountId, b.publicKey); return void send(res, Response.json({ ok: true })); }
      if (url === '/__harness/tx') { const b = await (await nodeRequest(req)).json(); chain.addTx(b.hash, b.tx); return void send(res, Response.json({ ok: true })); }
      if (url === '/__harness/redis') { const b = await (await nodeRequest(req)).json(); return void send(res, Response.json({ result: await redis.command(b.args) })); }
      if (url === '/api/mainnet/authority/challenge' || url === '/api/mainnet/authority/execute') {
        const request = await nodeRequest(req);
        const text = await request.clone().text();
        let account: string | undefined;
        try {
          const body = JSON.parse(text);
          account = url.endsWith('/challenge') ? byKey.get(body.publicKey) : challengeAccount.get(body.id);
        } catch { account = undefined; }
        const handler = account === undefined ? undefined : handlers.get(account);
        if (!handler) return void send(res, Response.json({ error: 'AUTHORITY_UNAVAILABLE' }, { status: 503 }));
        // Trusted IP comes from this harness, never from request headers.
        const out = await handler(new Request(request.url, { method: 'POST', headers: request.headers, body: text }), `198.51.100.${(ipCounter++ % 200) + 1}`);
        if (url.endsWith('/challenge') && out.ok) { const c = await out.clone().json() as { id: string }; challengeAccount.set(c.id, account!); }
        return void send(res, out);
      }
      res.writeHead(404); res.end();
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>((r) => server.listen(input.port, '127.0.0.1', () => r()));
  return { port: input.port, chain, witness, redis, provision, close: () => { server.close(); redis.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 8790), redisPort = Number(process.argv[3] ?? 6390);
  await startAuthorityHarness({ port, redisPort });
  console.log(`authority harness (TEST ONLY) on http://127.0.0.1:${port} (redis ${redisPort})`);
}
