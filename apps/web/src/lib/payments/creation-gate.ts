import { isBlocking } from './journal';
import type { JournalEntry } from './journal';

/**
 * Which earlier `create_request` attempts matter for a new one (Phase 7D).
 *
 * The rule itself is unchanged: an unexplained creation by this account on this
 * contract blocks new creations until a finalized read explains it (API.md:
 * never allocate another intent on an unknown submission). That gate is
 * account-wide on purpose: the screen cannot tell a new sale from a retry of
 * one whose outcome is unknown.
 *
 * These helpers only make it precise (current account and contract only) and
 * let the screen re-check the chain instead of waiting for a reload.
 */

/** A sale started this recently may be offered again as "ready for payment". */
export const RECENT_CREATION_WINDOW_MS = 30 * 60 * 1000;

export function creationsFor(entries: ReadonlyArray<JournalEntry>, creator: string, contractId: string): JournalEntry[] {
  return entries.filter((e) => e.method === 'create_request' && e.signerAccountId === creator && e.contractId === contractId);
}

/** Unexplained creations that block a new one. */
export function blockingCreations(entries: ReadonlyArray<JournalEntry>, creator: string, contractId: string): JournalEntry[] {
  return creationsFor(entries, creator, contractId).filter(isBlocking);
}

/**
 * The newest creation this device started recently, unless the wallet reported
 * a decline. Only a finalized read decides whether it exists and is still open.
 */
export function latestRecentCreation(
  entries: ReadonlyArray<JournalEntry>,
  creator: string,
  contractId: string,
  nowMs: number,
): JournalEntry | null {
  let latest: JournalEntry | null = null;
  for (const e of creationsFor(entries, creator, contractId)) {
    if (e.phase === 'USER_REJECTED' || e.terms === null) continue;
    const started = Date.parse(e.startedAt);
    if (!(nowMs - started <= RECENT_CREATION_WINDOW_MS && started <= nowMs + 60_000)) continue;
    if (latest === null || e.startedAt > latest.startedAt) latest = e;
  }
  return latest;
}

/** Re-check delay while the chain has not yet explained a creation: 3s, 6s, 12s, 24s, then every 30s. */
export function recheckDelayMs(pass: number): number {
  return Math.min(3_000 * 2 ** Math.max(0, Math.min(pass, 4)), 30_000);
}
