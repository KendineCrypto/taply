import type { VerificationFailure } from './instant-receipt';

/**
 * Automatic re-check schedule for the receipt verifier. Small and bounded on
 * purpose: public Testnet RPCs rate-limit per IP, and a receipt page left open
 * must not keep calling them.
 *
 *  - Only transient failures are retried, at most AUTO_RETRY_DELAYS_MS.length times.
 *  - A rate limit is honoured: the next try is never earlier than Retry-After.
 *  - A provider asking for longer than MAX_AUTO_WAIT_MS gets no automatic retry;
 *    the person sees when to check again and decides.
 *  - Everything else (mismatch, missing history, wrong network) is final for
 *    this attempt; only an explicit "Check again" runs the verifier again.
 */
export const AUTO_RETRY_DELAYS_MS: ReadonlyArray<number> = [2_000, 8_000, 30_000];
export const MAX_AUTO_WAIT_MS = 60_000;

export interface RetryInput {
  readonly reason: VerificationFailure;
  readonly transient: boolean;
  readonly retryAfterMs?: number | undefined;
}

/** Delay before the next automatic attempt, or null when the verifier should stop and wait for the person. */
export function nextAutoRetryDelay(outcome: RetryInput, retriesUsed: number): number | null {
  if (!outcome.transient) return null;
  const base = AUTO_RETRY_DELAYS_MS[retriesUsed];
  if (base === undefined) return null;
  const asked = outcome.retryAfterMs ?? (outcome.reason === 'RATE_LIMITED' ? null : 0);
  if (asked === null) return null;
  if (asked > MAX_AUTO_WAIT_MS) return null;
  return Math.max(base, asked);
}
