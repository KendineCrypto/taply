import type { RedisCommand } from '@/server/handshake/redis';

/**
 * Quote bookkeeping for replay and duplicate control (docs/MAINNET_BRIEF.md
 * §7.2): one live quote per request, a small lifetime limit per request, and a
 * short creation lock so two concurrent calls cannot both ask 1Click.
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

export interface QuoteStore {
  /** Runs `fn` under a short per-request lock; 'BUSY' if another call holds it. */
  withRequestLock<T>(requestId: string, fn: () => Promise<T>): Promise<T | 'BUSY'>;
  latest(requestId: string): Promise<QuoteRecord | null>;
  issuedCount(requestId: string): Promise<number>;
  save(record: QuoteRecord, retainMs: number): Promise<void>;
}

export const KEY_PREFIX = 'taply:mainnet:1click:';
const LOCK_MS = 30_000;
const COUNT_WINDOW_MS = 86_400_000;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

export function redisQuoteStore(redis: RedisCommand): QuoteStore {
  const k = (kind: string, id: string) => `${KEY_PREFIX}${kind}:${id}`;
  return {
    async withRequestLock(requestId, fn) {
      const token = randomToken();
      if ((await redis(['SET', k('lock', requestId), token, 'NX', 'PX', LOCK_MS])) !== 'OK') return 'BUSY';
      try {
        return await fn();
      } finally {
        await redis(['EVAL', RELEASE, 1, k('lock', requestId), token]).catch(() => undefined);
      }
    },
    async latest(requestId) {
      const raw = await redis(['GET', k('quote', requestId)]);
      return typeof raw === 'string' ? (JSON.parse(raw) as QuoteRecord) : null;
    },
    async issuedCount(requestId) {
      const raw = await redis(['GET', k('count', requestId)]);
      return typeof raw === 'string' || typeof raw === 'number' ? Number.parseInt(String(raw), 10) || 0 : 0;
    },
    async save(record, retainMs) {
      await redis(['SET', k('quote', record.requestId), JSON.stringify(record), 'PX', Math.max(1, Math.ceil(retainMs))]);
      const count = await redis(['INCR', k('count', record.requestId)]);
      if (String(count) === '1') await redis(['PEXPIRE', k('count', record.requestId), COUNT_WINDOW_MS]);
    },
  };
}

/** Single-process store: tests and fixture mode only (not durable across serverless instances). */
export function memoryQuoteStore(now: () => number = Date.now): QuoteStore {
  const locks = new Set<string>();
  const quotes = new Map<string, { record: QuoteRecord; until: number }>();
  const counts = new Map<string, number>();
  return {
    async withRequestLock(requestId, fn) {
      if (locks.has(requestId)) return 'BUSY';
      locks.add(requestId);
      try {
        return await fn();
      } finally {
        locks.delete(requestId);
      }
    },
    async latest(requestId) {
      const entry = quotes.get(requestId);
      return entry !== undefined && entry.until > now() ? entry.record : null;
    },
    async issuedCount(requestId) {
      return counts.get(requestId) ?? 0;
    },
    async save(record, retainMs) {
      quotes.set(record.requestId, { record, until: now() + retainMs });
      counts.set(record.requestId, (counts.get(record.requestId) ?? 0) + 1);
    },
  };
}
