import type { RedisCommand } from '@/server/handshake/redis';

/**
 * Quote bookkeeping for replay and duplicate control (docs/MAINNET_BRIEF.md
 * §7.2): durable per-attempt reservations, a lifetime attempt limit and atomic
 * state transitions. A worker restart or elapsed time never releases uncertainty.
 *
 * Mainnet keys live under their own prefix and, in production, in the mainnet
 * project's own Upstash database (docs/MAINNET_INFRA.md §4.1).
 */
export interface QuoteRecord {
  readonly requestId: string;
  readonly correlationId: string;
  readonly mode: 'fixture' | 'dry' | 'funded';
  readonly originAssetId: string;
  readonly refundTo: string;
  readonly depositAddress: string | null;
  readonly depositMemo: string | null;
  readonly deadlineMs: number;
  readonly createdAtMs: number;
  readonly amountIn: string;
  readonly amountInFormatted: string;
  readonly minAmountIn: string;
  readonly amountOut: string;
  readonly timeEstimateSec: number | null;
  /** The full signed response, kept as evidence for support and refunds. */
  readonly signedResponse: string;
}

export type AttemptState = 'RESERVED' | 'DISPATCHING' | 'READY' | 'UNCERTAIN';
export interface Attempt {
  readonly id: string;
  readonly requestId: string;
  readonly fence: number;
  readonly mode: QuoteRecord['mode'];
  readonly payload: string;
  readonly createdAtMs: number;
  readonly state: AttemptState;
  readonly record: QuoteRecord | null;
}
export type Reservation = Omit<Attempt, 'fence' | 'state' | 'record'>;
export type ReserveResult = Attempt | 'BUSY' | 'LIMIT' | 'LEGACY_BLOCKED';
export interface QuoteStore {
  current(requestId: string): Promise<Attempt | null>;
  latest(requestId: string): Promise<QuoteRecord | null>;
  reserve(input: Reservation, expectedId: string | null): Promise<ReserveResult>;
  transition(attempt: Attempt, state: 'DISPATCHING' | 'READY' | 'UNCERTAIN', record?: QuoteRecord): Promise<boolean>;
}

export const KEY_PREFIX = 'taply:mainnet:1click:';
export const MAX_ATTEMPTS = 3;
// One no-TTL ledger contains the monotonic fence, active pointer and every attempt.
// Lua changes it in ONE SET: no partial multi-command reservation/counter writes.
const RESERVE = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 'LEGACY_BLOCKED' end
local raw = redis.call('GET', KEYS[1])
local ledger = raw and cjson.decode(raw) or {version=1, fence=0, active='', attempts={}}
if ledger.version ~= 1 then return redis.error_reply('LEDGER_VERSION') end
if ledger.active ~= ARGV[2] then return 'BUSY' end
if ledger.active ~= '' then
  local old = ledger.attempts[ledger.active]
  if old.mode == 'funded' or old.state ~= 'READY' or old.record == cjson.null or old.record.depositAddress ~= cjson.null or old.record.deadlineMs > tonumber(ARGV[3]) then return 'BUSY' end
end
if ledger.fence >= ${MAX_ATTEMPTS} then return 'LIMIT' end
local a = cjson.decode(ARGV[1])
if ledger.attempts[a.id] then return 'BUSY' end
ledger.fence = ledger.fence + 1
a.fence = ledger.fence; a.state = 'RESERVED'; a.record = cjson.null
ledger.active = a.id; ledger.attempts[a.id] = a
redis.call('SET', KEYS[1], cjson.encode(ledger))
return cjson.encode(a)`;
const TRANSITION = `
local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end
local ledger = cjson.decode(raw)
local a = ledger.attempts[ARGV[1]]
if ledger.version ~= 1 or ledger.active ~= ARGV[1] or not a or a.fence ~= tonumber(ARGV[2]) or a.state ~= ARGV[3] then return 0 end
local target = ARGV[4]
if not ((a.state == 'RESERVED' and target == 'DISPATCHING') or (a.state == 'DISPATCHING' and (target == 'READY' or target == 'UNCERTAIN'))) then return 0 end
if target == 'READY' then
  local record = cjson.decode(ARGV[5])
  if record.requestId ~= a.requestId or record.mode ~= a.mode or (a.mode ~= 'funded' and record.depositAddress ~= cjson.null) then return 0 end
  a.record = record
end
a.state = target
redis.call('SET', KEYS[1], cjson.encode(ledger))
return 1`;

export function redisQuoteStore(redis: RedisCommand): QuoteStore {
  const key = (id: string) => `${KEY_PREFIX}ledger:v1:${id}`;
  const store: QuoteStore = {
    async current(id) {
      const raw = await redis(['GET', key(id)]);
      if (raw === null) return null;
      if (typeof raw !== 'string') throw new Error('INVALID_LEDGER');
      const ledger = JSON.parse(raw);
      const active = ledger.attempts?.[ledger.active];
      if (ledger.version !== 1 || !active || active.requestId !== id) throw new Error('INVALID_LEDGER');
      return active as Attempt;
    },
    async latest(id) { return (await store.current(id))?.record ?? null; },
    async reserve(input, expectedId) {
      const result = await redis(['EVAL', RESERVE, 2, key(input.requestId), `${KEY_PREFIX}quote:${input.requestId}`, JSON.stringify(input), expectedId ?? '', input.createdAtMs]);
      if (result === 'BUSY' || result === 'LIMIT' || result === 'LEGACY_BLOCKED') return result;
      if (typeof result !== 'string') throw new Error('RESERVATION_UNCERTAIN');
      return JSON.parse(result) as Attempt;
    },
    async transition(a, state, record) {
      return await redis(['EVAL', TRANSITION, 1, key(a.requestId), a.id, a.fence, a.state, state, JSON.stringify(record ?? null)]) === 1;
    },
  };
  return store;
}

/** Only fixtures/tests. Never a fallback when the durable database is unavailable. */
export function memoryQuoteStore(_now: () => number = Date.now): QuoteStore {
  void _now; // Compatibility for fixture callers; attempt records intentionally never expire.
  const ledgers = new Map<string, Attempt[]>();
  const store: QuoteStore = {
    async current(id) { return ledgers.get(id)?.at(-1) ?? null; },
    async latest(id) { return (await store.current(id))?.record ?? null; },
    async reserve(input, expectedId) {
      const attempts = ledgers.get(input.requestId) ?? [];
      const old = attempts.at(-1);
      if ((old?.id ?? null) !== expectedId) return 'BUSY';
      if (old && (old.mode === 'funded' || old.state !== 'READY' || !old.record || old.record.depositAddress !== null || old.record.deadlineMs > input.createdAtMs)) return 'BUSY';
      if (attempts.length >= MAX_ATTEMPTS) return 'LIMIT';
      if (attempts.some(a => a.id === input.id)) return 'BUSY';
      const attempt: Attempt = { ...input, fence: attempts.length + 1, state: 'RESERVED', record: null };
      ledgers.set(input.requestId, [...attempts, attempt]);
      return attempt;
    },
    async transition(a, state, record) {
      const attempts = ledgers.get(a.requestId);
      const old = attempts?.at(-1);
      if (!old || old.id !== a.id || old.fence !== a.fence || old.state !== a.state) return false;
      if (!(old.state === 'RESERVED' && state === 'DISPATCHING' || old.state === 'DISPATCHING' && (state === 'READY' || state === 'UNCERTAIN'))) return false;
      if (state === 'READY' && (!record || record.requestId !== a.requestId || record.mode !== a.mode || a.mode !== 'funded' && record.depositAddress !== null)) return false;
      ledgers.set(a.requestId, [...attempts!.slice(0, -1), { ...old, state, record: record ?? old.record }]);
      return true;
    },
  };
  return store;
}
