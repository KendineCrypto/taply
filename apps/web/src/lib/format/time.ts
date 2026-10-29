import type { Locale } from '@/lib/i18n';
import type { DecimalString } from '@/lib/protocol';

/**
 * Nanosecond chain timestamps are canonical decimal strings (freeze section 3).
 * They are parsed with BigInt and only converted to a Number of milliseconds at
 * the final display boundary, where Date/Intl require it. That conversion is
 * safe for wall-clock values and is never applied to money.
 */

const NS_PER_MS = 1_000_000n;

export function nsToDate(ns: DecimalString): Date {
  const millis = BigInt(ns) / NS_PER_MS;
  return new Date(globalThis.Number(millis));
}

/** Freeze section 4 bounds for the Protected cancel window: 60-3600 seconds. */
export const CANCEL_DURATION_MIN_NS = 60_000_000_000n;
export const CANCEL_DURATION_MAX_NS = 3_600_000_000_000n;
export const CANCEL_DURATION_DEFAULT_NS = CANCEL_DURATION_MIN_NS;

export function isAllowedCancelDurationNs(ns: DecimalString): boolean {
  const value = BigInt(ns);
  return value >= CANCEL_DURATION_MIN_NS && value <= CANCEL_DURATION_MAX_NS;
}

export function cancelDurationSeconds(ns: DecimalString): bigint {
  return BigInt(ns) / 1_000_000_000n;
}

/**
 * Both UTC and local, as required for the post-funding cutoff display. Local
 * formatting uses the browser zone; UTC is always shown alongside it so the two
 * parties can compare the same instant.
 */
export function formatCutoff(ns: DecimalString, locale: Locale): { utc: string; local: string } {
  const date = nsToDate(ns);
  const utc = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
  const local = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
  return { utc: `${utc} UTC`, local };
}

/**
 * A sample of chain time, used to anchor countdowns.
 *
 * Freeze section 9: the countdown is informational and "clicking before zero
 * does not guarantee inclusion before cutoff". Anchoring to the observed block
 * timestamp plus monotonic elapsed time keeps a wrong device clock from making
 * the UI claim cancel rights the chain will not honour.
 */
export interface ClockAnchor {
  readonly chainTimeNs: DecimalString;
  /** performance.now() reading captured at the same moment. */
  readonly monotonicMs: number;
}

export function estimateChainNowNs(anchor: ClockAnchor, nowMonotonicMs: number): bigint {
  const elapsedMs = Math.max(0, nowMonotonicMs - anchor.monotonicMs);
  return BigInt(anchor.chainTimeNs) + BigInt(Math.trunc(elapsedMs)) * NS_PER_MS;
}

export interface CountdownEstimate {
  readonly remainingMs: number;
  readonly elapsed: boolean;
  /** Always true: this is an estimate, never an authority. */
  readonly approximate: true;
}

export function estimateRemaining(
  cancelUntilNs: DecimalString,
  anchor: ClockAnchor,
  nowMonotonicMs: number,
): CountdownEstimate {
  const nowNs = estimateChainNowNs(anchor, nowMonotonicMs);
  const remainingNs = BigInt(cancelUntilNs) - nowNs;
  if (remainingNs <= 0n) return { remainingMs: 0, elapsed: true, approximate: true };
  return {
    remainingMs: globalThis.Number(remainingNs / NS_PER_MS),
    elapsed: false,
    approximate: true,
  };
}
