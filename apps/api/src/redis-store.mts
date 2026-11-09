import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';

/**
 * Durable, encrypted, race-safe state on Redis (Upstash REST in production).
 *
 * - Every record is AES-256-GCM encrypted with a server-only 32-byte key; the
 *   AAD binds format + namespace + record name, so a blob cannot be moved.
 * - Writes are optimistic: read (value, version) -> run the action -> one Lua
 *   script atomically checks the version is unchanged, writes value+version+TTL.
 *   A concurrent writer makes the check fail and the transaction is retried on
 *   fresh state (bounded). This is NOT a plain read-modify-write.
 * - Any transport/decryption/format error fails closed (VERIFICATION_UNAVAILABLE);
 *   there is no silent re-initialisation and no in-memory fallback.
 */
export type RedisCommand = (args: ReadonlyArray<string>) => Promise<unknown>;

const CAS = `local v = redis.call('GET', KEYS[2])
if (v or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
return 1`;

export class RedisDurableStore<T> {
  readonly #command: RedisCommand; readonly #key: Buffer; readonly #prefix: string;
  readonly #initial: () => T; readonly #validate: (state: T) => void; readonly #ttlMs: number;
  constructor(input: { command: RedisCommand; key: Uint8Array; namespace: string; initial: () => T;
    validate?: (state: T) => void; ttlMs: number }) {
    if (input.key.byteLength !== 32 || !/^[a-z0-9-]{1,48}$/.test(input.namespace)
      || !Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1000 || input.ttlMs > 30 * 86_400_000) throw Error('INVALID_ARGUMENT');
    this.#command = input.command; this.#key = Buffer.from(input.key); this.#prefix = `taply:${input.namespace}`;
    this.#initial = input.initial; this.#validate = input.validate ?? (() => undefined); this.#ttlMs = input.ttlMs;
  }
  #aad(name: string) { return Buffer.from(`taply.redis.v1:${this.#prefix}:${name}`); }
  #encrypt(name: string, value: T): string {
    const bytes = serialize({ format: 'taply.redis.v1', state: value });
    if (bytes.length > 512 * 1024) throw Error('RATE_LIMITED');
    const nonce = randomBytes(12); const c = createCipheriv('aes-256-gcm', this.#key, nonce); c.setAAD(this.#aad(name));
    const body = Buffer.concat([c.update(bytes), c.final()]);
    return Buffer.concat([nonce, c.getAuthTag(), body]).toString('base64');
  }
  #decrypt(name: string, text: string): T {
    try {
      const bytes = Buffer.from(text, 'base64'); const d = createDecipheriv('aes-256-gcm', this.#key, bytes.subarray(0, 12));
      d.setAAD(this.#aad(name)); d.setAuthTag(bytes.subarray(12, 28));
      const env = deserialize(Buffer.concat([d.update(bytes.subarray(28)), d.final()]));
      if (!env || env.format !== 'taply.redis.v1' || !Object.hasOwn(env, 'state')) throw Error();
      const state = env.state as T; this.#validate(state); return state;
    } catch { throw Error('VERIFICATION_UNAVAILABLE'); }
  }
  async #run(args: ReadonlyArray<string>): Promise<unknown> {
    try { return await this.#command(args); } catch { throw Error('VERIFICATION_UNAVAILABLE'); }
  }
  /** Atomic, retried, encrypted transaction on one named record. `action` must be synchronous and pure on `state`. */
  async transaction<R>(name: string, action: (state: T) => R, attempts = 8): Promise<R> {
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(name)) throw Error('INVALID_ARGUMENT');
    const dataKey = `${this.#prefix}:${name}`, versionKey = `${dataKey}:v`;
    for (let i = 0; i < attempts; i++) {
      // ONE atomic read of value + version (two GETs could pair old data with a newer version).
      const pair = await this.#run(['MGET', dataKey, versionKey]);
      if (!Array.isArray(pair) || pair.length !== 2) throw Error('VERIFICATION_UNAVAILABLE');
      const [raw, version] = pair as [unknown, unknown];
      if ((raw === null) !== (version === null)) throw Error('VERIFICATION_UNAVAILABLE');
      const state = raw === null ? this.#initial() : this.#decrypt(name, String(raw));
      const result = action(state);
      if (result instanceof Promise) throw Error('INVALID_ARGUMENT');
      const output = structuredClone(result);
      const next = String(version === null ? 1 : Number(version) + 1);
      const ok = await this.#run(['EVAL', CAS, '2', dataKey, versionKey, version === null ? '' : String(version),
        this.#encrypt(name, state), next, String(this.#ttlMs)]);
      if (Number(ok) === 1) return output;
    }
    throw Error('RATE_LIMITED'); // persistent contention: fail closed, caller may retry later
  }
  async read(name: string): Promise<T | null> {
    const raw = await this.#run(['GET', `${this.#prefix}:${name}`]);
    return raw === null ? null : this.#decrypt(name, String(raw));
  }
}

/** Upstash REST transport. URL/token are server-only (KV_REST_API_URL / KV_REST_API_TOKEN). */
export function upstashCommand(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): RedisCommand {
  const url = env['KV_REST_API_URL'], token = env['KV_REST_API_TOKEN'];
  if (!url || !token || !url.startsWith('https://')) throw Error('VERIFICATION_UNAVAILABLE');
  return async (args) => {
    const res = await fetcher(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args), cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const body = await res.json() as { result?: unknown; error?: string };
    if (!res.ok || body.error !== undefined) throw Error('REDIS_ERROR');
    return body.result ?? null;
  };
}

/** Server-only session key from TAPLY_SESSION_ENCRYPTION_KEY (base64, exactly 32 bytes). */
export function sessionKeyFromEnv(env: Record<string, string | undefined> = process.env): Uint8Array {
  const value = env['TAPLY_SESSION_ENCRYPTION_KEY'];
  const key = value ? Buffer.from(value, 'base64') : Buffer.alloc(0);
  if (key.byteLength !== 32) throw Error('VERIFICATION_UNAVAILABLE');
  return key;
}
