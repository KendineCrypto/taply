/**
 * Indicative countdown to the on-chain cancellation cutoff.
 *
 * The contract decides with block time at EXECUTION. This estimate only moves
 * the last observed final block forward by the time elapsed on this device, so
 * it is labelled approximate and never enables or disables an action by itself:
 * actions follow the derived projection of a fresh final read.
 */
export type CountdownEstimate =
  | { readonly phase: 'open'; readonly remainingMs: number }
  /** The estimate reached zero; wait for a final block to confirm before release. */
  | { readonly phase: 'reached_by_estimate' };

export function estimateCutoff(input: {
  readonly cancelUntilNs: string;
  readonly observedAtNs: string;
  /** Device time (ms) when that observation was received. */
  readonly observedAtLocalMs: number;
  readonly nowMs: number;
}): CountdownEstimate {
  const leftAtObservationMs = (BigInt(input.cancelUntilNs) - BigInt(input.observedAtNs)) / 1_000_000n;
  const elapsed = Math.max(0, input.nowMs - input.observedAtLocalMs);
  const remaining = Number(leftAtObservationMs) - elapsed;
  return remaining > 0 ? { phase: 'open', remainingMs: remaining } : { phase: 'reached_by_estimate' };
}

/** "m:ss" for the visible countdown; screen readers get the long form from copy. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Duration from signed terms (ns, decimal string) as whole seconds. */
export function durationSeconds(cancelDurationNs: string): number {
  return Number(BigInt(cancelDurationNs) / 1_000_000_000n);
}
