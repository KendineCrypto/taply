// The gate lives in rpc.ts (see the note there); this module keeps the old import path.
export {
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  MAX_RATE_LIMIT_COOLDOWN_MS,
  MIN_RATE_LIMIT_COOLDOWN_MS,
  NETWORK_BACKOFF_MAX_MS,
  NETWORK_BACKOFF_START_MS,
  clampCooldownMs,
  createRateLimitGate,
  parseRetryAfterMs,
} from './rpc';
export type { RateLimitGate } from './rpc';
