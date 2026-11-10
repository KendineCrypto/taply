// Development/test tool: serves the Upstash Redis REST protocol (POST [cmd,...] ->
// {result}) on top of a REAL local redis-server, so Live Handshake runs against
// actual Redis semantics (Lua EVAL, NX, PX, lists) without an Upstash account.
// Usage: node scripts/redis-rest-shim.mjs <redisPort> <httpPort> <token>
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { pathToFileURL } from 'node:url';

/** Tiny RESP2 client: one in-flight command at a time (serialized). */
export function createRespCommand(port, host = '127.0.0.1') {
  const socket = connect(port, host);
  let buffer = Buffer.alloc(0);
  const waiting = [];
  let chain = Promise.resolve();
  const parse = (buf, at) => {
    const end = buf.indexOf('\r\n', at);
    if (end < 0) return null;
    const type = String.fromCharCode(buf[at]);
    const line = buf.toString('utf8', at + 1, end);
    const next = end + 2;
    if (type === '+') return { value: line, next };
    if (type === '-') return { value: new Error(line), next };
    if (type === ':') return { value: Number(line), next };
    if (type === '$') {
      const len = Number(line);
      if (len < 0) return { value: null, next };
      if (buf.length < next + len + 2) return null;
      return { value: buf.toString('utf8', next, next + len), next: next + len + 2 };
    }
    if (type === '*') {
      const count = Number(line);
      if (count < 0) return { value: null, next };
      const items = []; let pos = next;
      for (let i = 0; i < count; i++) { const r = parse(buf, pos); if (r === null) return null; items.push(r.value); pos = r.next; }
      return { value: items, next: pos };
    }
    throw new Error('RESP parse');
  };
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (waiting.length > 0) {
      const r = parse(buffer, 0);
      if (r === null) break;
      buffer = buffer.subarray(r.next);
      waiting.shift()(r.value);
    }
  });
  const command = (args) => {
    const run = () => new Promise((resolve, reject) => {
      const parts = args.map(String);
      let out = `*${parts.length}\r\n`;
      for (const p of parts) out += `$${Buffer.byteLength(p)}\r\n${p}\r\n`;
      waiting.push((v) => (v instanceof Error ? reject(v) : resolve(v)));
      socket.write(out);
    });
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  };
  command.close = () => socket.end();
  return command;
}

export function startRestShim({ redisPort, port = 0, token }) {
  const command = createRespCommand(redisPort);
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('{"error":"unauthorized"}'); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      try {
        const args = JSON.parse(body);
        const result = await command(args);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(error.message ?? error) }));
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((r) => { command.close(); server.close(() => r()); }),
  })));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [redisPort, httpPort, token] = process.argv.slice(2);
  const shim = await startRestShim({ redisPort: Number(redisPort), port: Number(httpPort), token });
  console.log(`redis-rest-shim ${shim.url}`);
}
