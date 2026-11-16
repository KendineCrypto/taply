import type { RedisCommand } from '@/server/handshake/redis';

/**
 * Durable 1Click attempt ledger (docs/MAINNET_1CLICK_INTEGRATION.md, "Attempts").
 *
 * One no-TTL ledger per request holds every attempt. All changes are single
 * atomic Lua scripts (one SET), so there are no partial writes.
 *
 * Ownership: each attempt stores only `ownerHash` = SHA-256 of a 256-bit secret
 * that the payer's browser generated and keeps. The deposit address of a funded
 * attempt is returned only to a caller presenting that secret. Nobody else can
 * read, replace or reuse it, and the request id (public, it is in the QR link)
 * is not enough to do anything but read a redacted progress hint.
 *
 * Blocking rules (why a second payer cannot double-pay a request):
 *  - A READY funded attempt with a deposit address blocks new attempts until it
 *    is RELEASED. Only the service releases it, only after its deadline, and
 *    only when 1Click reports that the address can no longer deliver
 *    (REFUNDED/FAILED, or still PENDING_DEPOSIT a grace period after the
 *    deadline: 1Click refunds deposits that arrive after the deadline).
 *    Elapsed time alone never releases a fundable attempt.
 *  - A RESERVED/DISPATCHING/UNCERTAIN attempt never had its deposit address
 *    shown to anyone (an address leaves the server only from a READY record).
 *    It still blocks until its own quote deadline plus the grace period, after
 *    which even a hypothetically leaked address would be refunded by 1Click.
 *  - A READY dry/fixture quote (no deposit address, cannot be funded) blocks
 *    only until its deadline.
 *  - Lifetime cap: MAX_ATTEMPTS per request, so an attacker can delay but not
 *    endlessly occupy a request; the requester can always create a new one,
 *    and paying with a NEAR wallet is unaffected.
 *
 * Mainnet keys live under their own prefix and, in production, in the mainnet
 * project's own Upstash database (docs/MAINNET_INFRA.md §4.1). The v1 ledger
 * (`ledger:v1:`) could only ever hold dry/fixture attempts (funded quotes were
 * refused in code before any write); a v1 ledger containing a funded attempt
 * quarantines the request instead of being ignored.
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
export type ReleaseReason = 'UPSTREAM_REFUNDED' | 'UPSTREAM_FAILED' | 'EXPIRED_NO_DEPOSIT';
export interface Attempt {
  readonly id: string;
  readonly requestId: string;
  readonly fence: number;
  readonly mode: QuoteRecord['mode'];
  readonly payload: string;
  readonly createdAtMs: number;
  /** The deadline Taply asked 1Click for; the signed quote deadline can only be earlier. */
  readonly deadlineMs: number;
  /** SHA-256 (hex) of the owner's attempt secret. The secret itself is never stored. */
  readonly ownerHash: string;
  readonly state: AttemptState;
  readonly record: QuoteRecord | null;
  readonly released: { readonly atMs: number; readonly reason: ReleaseReason } | null;
}
export type Reservation = Omit<Attempt, 'fence' | 'state' | 'record' | 'released'>;
export type ReserveResult =
  | { readonly kind: 'RESERVED'; readonly attempt: Attempt }
  /** The caller already owns the attempt that blocks the request: resume it. */
  | { readonly kind: 'OWNED'; readonly attempt: Attempt }
  /** Another owner's attempt blocks the request. Server-side only: never returned to a browser. */
  | { readonly kind: 'ACTIVE'; readonly attempt: Attempt }
  /** A not-yet-READY attempt is in progress or uncertain. */
  | { readonly kind: 'BUSY'; readonly attempt?: Attempt }
  | { readonly kind: 'LIMIT' }
  | { readonly kind: 'LEGACY_BLOCKED' };
export interface QuoteStore {
  /** Every attempt of a request, oldest first. */
  attempts(requestId: string): Promise<ReadonlyArray<Attempt>>;
  reserve(input: Reservation, nowMs: number): Promise<ReserveResult>;
  transition(attempt: Attempt, state: 'DISPATCHING' | 'READY' | 'UNCERTAIN', record?: QuoteRecord): Promise<boolean>;
  release(attempt: Attempt, nowMs: number, reason: ReleaseReason): Promise<boolean>;
}

export const KEY_PREFIX = 'taply:mainnet:1click:';
export const MAX_ATTEMPTS = 3;
/** After a quote deadline, how long 1Click may still be finishing a deposit made just before it. */
export const RELEASE_GRACE_MS = 60 * 60_000;

const RESERVE = `
if redis.call('EXISTS', KEYS[2]) == 1 then return cjson.encode({kind='LEGACY_BLOCKED'}) end
local v1 = redis.call('GET', KEYS[3])
if v1 then
  local old = cjson.decode(v1)
  for _, a in pairs(old.attempts or {}) do
    if a.mode == 'funded' then return cjson.encode({kind='LEGACY_BLOCKED'}) end
  end
end
local raw = redis.call('GET', KEYS[1])
local ledger = raw and cjson.decode(raw) or {version=2, fence=0, order={}, attempts={}}
if ledger.version ~= 2 then return redis.error_reply('LEDGER_VERSION') end
local new = cjson.decode(ARGV[1])
local now = tonumber(ARGV[2])
local grace = tonumber(ARGV[3])
if new.requestId ~= ARGV[5] then return redis.error_reply('REQUEST_MISMATCH') end
for _, id in ipairs(ledger.order) do
  local a = ledger.attempts[id]
  if a.released == cjson.null then
    if a.state == 'READY' and a.record ~= cjson.null then
      if a.record.depositAddress ~= cjson.null or a.record.deadlineMs > now then
        local kind = 'ACTIVE'
        if a.ownerHash == new.ownerHash then kind = 'OWNED' end
        return cjson.encode({kind=kind, attempt=a})
      end
    elseif now <= a.deadlineMs + grace then
      return cjson.encode({kind='BUSY', attempt=a})
    end
  end
end
if ledger.fence >= tonumber(ARGV[4]) then return cjson.encode({kind='LIMIT'}) end
if ledger.attempts[new.id] then return cjson.encode({kind='BUSY'}) end
ledger.fence = ledger.fence + 1
new.fence = ledger.fence; new.state = 'RESERVED'; new.record = cjson.null; new.released = cjson.null
ledger.attempts[new.id] = new
table.insert(ledger.order, new.id)
redis.call('SET', KEYS[1], cjson.encode(ledger))
return cjson.encode({kind='RESERVED', attempt=new})`;

const TRANSITION = `
local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end
local ledger = cjson.decode(raw)
local a = ledger.attempts[ARGV[1]]
if ledger.version ~= 2 or not a or a.fence ~= tonumber(ARGV[2]) or a.state ~= ARGV[3] or a.released ~= cjson.null then return 0 end
local target = ARGV[4]
if not ((a.state == 'RESERVED' and target == 'DISPATCHING') or (a.state == 'DISPATCHING' and (target == 'READY' or target == 'UNCERTAIN'))) then return 0 end
if target == 'READY' then
  local record = cjson.decode(ARGV[5])
  if record.requestId ~= a.requestId or record.mode ~= a.mode or (a.mode ~= 'funded' and record.depositAddress ~= cjson.null) or record.deadlineMs > a.deadlineMs then return 0 end
  if record.depositAddress ~= cjson.null then
    for _, id in ipairs(ledger.order) do
      local o = ledger.attempts[id]
      if id ~= a.id and o.released == cjson.null and o.state == 'READY' and o.record ~= cjson.null and o.record.depositAddress ~= cjson.null then return 0 end
    end
  end
  a.record = record
end
a.state = target
redis.call('SET', KEYS[1], cjson.encode(ledger))
return 1`;

const RELEASE = `
local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end
local ledger = cjson.decode(raw)
local a = ledger.attempts[ARGV[1]]
if ledger.version ~= 2 or not a or a.fence ~= tonumber(ARGV[2]) or a.released ~= cjson.null or a.state ~= 'READY' or a.record == cjson.null then return 0 end
if tonumber(ARGV[3]) <= a.record.deadlineMs then return 0 end
a.released = {atMs=tonumber(ARGV[3]), reason=ARGV[4]}
redis.call('SET', KEYS[1], cjson.encode(ledger))
return 1`;

function parseLedger(raw: unknown, requestId: string): ReadonlyArray<Attempt> {
  if (raw === null) return [];
  if (typeof raw !== 'string') throw new Error('INVALID_LEDGER');
  const ledger = JSON.parse(raw) as { version?: unknown; order?: unknown; attempts?: Record<string, Attempt> };
  if (ledger.version !== 2 || !ledger.attempts || typeof ledger.attempts !== 'object') throw new Error('INVALID_LEDGER');
  // cjson encodes an empty array as {}; a saved ledger always has at least one attempt.
  const order = Array.isArray(ledger.order) ? (ledger.order as unknown[]) : [];
  const out: Attempt[] = [];
  for (const id of order) {
    const a = typeof id === 'string' ? ledger.attempts[id] : undefined;
    if (!a || a.requestId !== requestId || a.id !== id) throw new Error('INVALID_LEDGER');
    out.push(a);
  }
  return out;
}

const RESULT_KINDS = new Set(['RESERVED', 'OWNED', 'ACTIVE', 'BUSY', 'LIMIT', 'LEGACY_BLOCKED']);

export function redisQuoteStore(redis: RedisCommand): QuoteStore {
  const key = (id: string) => `${KEY_PREFIX}ledger:v2:${id}`;
  return {
    async attempts(id) { return parseLedger(await redis(['GET', key(id)]), id); },
    async reserve(input, nowMs) {
      const result = await redis(['EVAL', RESERVE, 3, key(input.requestId), `${KEY_PREFIX}quote:${input.requestId}`, `${KEY_PREFIX}ledger:v1:${input.requestId}`,
        JSON.stringify({ ...input, released: null }), nowMs, RELEASE_GRACE_MS, MAX_ATTEMPTS, input.requestId]);
      if (typeof result !== 'string') throw new Error('RESERVATION_UNCERTAIN');
      const parsed = JSON.parse(result) as ReserveResult;
      if (!RESULT_KINDS.has(parsed.kind)) throw new Error('RESERVATION_UNCERTAIN');
      return parsed;
    },
    async transition(a, state, record) {
      return await redis(['EVAL', TRANSITION, 1, key(a.requestId), a.id, a.fence, a.state, state, JSON.stringify(record ?? null)]) === 1;
    },
    async release(a, nowMs, reason) {
      return await redis(['EVAL', RELEASE, 1, key(a.requestId), a.id, a.fence, nowMs, reason]) === 1;
    },
  };
}

/** Only fixtures/tests. Never a fallback when the durable database is unavailable. Same rules as the Lua scripts. */
export function memoryQuoteStore(_now: () => number = Date.now): QuoteStore {
  void _now; // Compatibility for fixture callers; attempt records intentionally never expire.
  const ledgers = new Map<string, Attempt[]>();
  const fundable = (a: Attempt) => a.released === null && a.state === 'READY' && a.record !== null && a.record.depositAddress !== null;
  const replace = (a: Attempt, next: Attempt) => {
    const list = ledgers.get(a.requestId)!;
    ledgers.set(a.requestId, list.map(x => (x.id === a.id ? next : x)));
  };
  const find = (a: Attempt) => ledgers.get(a.requestId)?.find(x => x.id === a.id) ?? null;
  return {
    async attempts(id) { return [...(ledgers.get(id) ?? [])]; },
    async reserve(input, nowMs) {
      const list = ledgers.get(input.requestId) ?? [];
      for (const a of list) {
        if (a.released !== null) continue;
        if (a.state === 'READY' && a.record !== null) {
          if (a.record.depositAddress !== null || a.record.deadlineMs > nowMs) return { kind: a.ownerHash === input.ownerHash ? 'OWNED' : 'ACTIVE', attempt: a };
        } else if (nowMs <= a.deadlineMs + RELEASE_GRACE_MS) return { kind: 'BUSY', attempt: a };
      }
      if (list.length >= MAX_ATTEMPTS) return { kind: 'LIMIT' };
      if (list.some(a => a.id === input.id)) return { kind: 'BUSY' };
      const attempt: Attempt = { ...input, fence: list.length + 1, state: 'RESERVED', record: null, released: null };
      ledgers.set(input.requestId, [...list, attempt]);
      return { kind: 'RESERVED', attempt };
    },
    async transition(a, state, record) {
      const old = find(a);
      if (!old || old.fence !== a.fence || old.state !== a.state || old.released !== null) return false;
      if (!(old.state === 'RESERVED' && state === 'DISPATCHING' || old.state === 'DISPATCHING' && (state === 'READY' || state === 'UNCERTAIN'))) return false;
      if (state === 'READY') {
        if (!record || record.requestId !== a.requestId || record.mode !== old.mode || old.mode !== 'funded' && record.depositAddress !== null || record.deadlineMs > old.deadlineMs) return false;
        if (record.depositAddress !== null && (ledgers.get(a.requestId) ?? []).some(o => o.id !== a.id && fundable(o))) return false;
      }
      replace(a, { ...old, state, record: record ?? old.record });
      return true;
    },
    async release(a, nowMs, reason) {
      const old = find(a);
      if (!old || old.fence !== a.fence || old.released !== null || old.state !== 'READY' || old.record === null || nowMs <= old.record.deadlineMs) return false;
      replace(a, { ...old, released: { atMs: nowMs, reason } });
      return true;
    },
  };
}
