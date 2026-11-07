/**
 * Polite handling of public NEAR Testnet RPC rate limits (HTTP 429).
 *
 * Public RPCs throttle per IP. When one says "slow down", every reader that
 * shares this gate (the receipt verifier and the funding locator) stops calling
 * that RPC until the cool-down ends. Calls made during the cool-down fail at
 * once with RATE_LIMITED, without touching the network, so a retry button or a
 * second component cannot keep hammering a provider that already said no.
 *
 * The gate never produces chain data. It only ever turns calls into errors.
 */

/** Used when a 429 carries no usable Retry-After header. */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000;
/** Shortest cool-down we honour, so a `Retry-After: 0` storm cannot spin. */
export const MIN_RATE_LIMIT_COOLDOWN_MS = 2_000;
/**
 * Longest cool-down this tab keeps. A provider asking for longer (we saw
 * `Retry-After: 418`) is still respected for 10 minutes; after that one manual
 * "Check again" may try once more.
 */
export const MAX_RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;

/**
 * Parses an HTTP Retry-After value (delay-seconds or HTTP-date) into a delay in
 * milliseconds. Returns null for missing or unusable values. Never negative.
 */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // An HTTP header in whole seconds (at most 7 digits), not a chain amount.
  if (/^\d{1,7}$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000;
  // HTTP-date. Only accept something Date can parse to a real instant.
  if (!/[a-z]/i.test(trimmed)) return null;
  const at = Date.parse(trimmed);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

export function clampCooldownMs(ms: number | null): number {
  const value = ms ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  return Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, value));
}

/**
 * Browsers hide many 429s: a provider that omits CORS headers on its 429 (we
 * saw this from archival-rpc.testnet.near.org) looks exactly like a network
 * error, and Retry-After is not a CORS-exposed header. So repeated opaque
 * failures also back off, doubling from 2 s to at most 60 s, and reset on the
 * first good answer. During that back-off calls fail fast as "unavailable"
 * (never as "rate limited", which we could not see).
 */
export const NETWORK_BACKOFF_START_MS = 2_000;
export const NETWORK_BACKOFF_MAX_MS = 60_000;

export interface RateLimitGate {
  /** Milliseconds left in the current provider-requested cool-down, or 0 when calls may go out. */
  remainingMs(): number;
  /** Milliseconds left in the back-off after opaque network failures, or 0. */
  backoffRemainingMs(): number;
  /** An opaque failure (network error, timeout, 5xx without Retry-After). */
  noteNetworkFailure(): void;
  /** A well-formed answer arrived: clears the network back-off (not a provider cool-down). */
  noteSuccess(): void;
  /** Epoch ms when the cool-down ends, or null when there is none. */
  blockedUntil(): number | null;
  /** Records a rate-limit answer. A later end time wins; an earlier one never shortens it. */
  note(cooldownMs: number): void;
  subscribe(listener: () => void): () => void;
}

export function createRateLimitGate(now: () => number = () => Date.now()): RateLimitGate {
  let until: number | null = null;
  let backoffUntil = 0;
  let failures = 0;
  const listeners = new Set<() => void>();
  const remaining = () => {
    if (until === null) return 0;
    const left = until - now();
    if (left <= 0) {
      until = null;
      return 0;
    }
    return left;
  };
  return {
    remainingMs: remaining,
    backoffRemainingMs: () => Math.max(0, backoffUntil - now()),
    noteNetworkFailure() {
      failures += 1;
      const delay = Math.min(NETWORK_BACKOFF_MAX_MS, NETWORK_BACKOFF_START_MS * 2 ** Math.min(failures - 1, 10));
      backoffUntil = Math.max(backoffUntil, now() + delay);
    },
    noteSuccess() {
      failures = 0;
      backoffUntil = 0;
    },
    blockedUntil: () => (remaining() > 0 ? until : null),
    note(cooldownMs) {
      const end = now() + clampCooldownMs(cooldownMs);
      if (until !== null && until >= end) return;
      until = end;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
