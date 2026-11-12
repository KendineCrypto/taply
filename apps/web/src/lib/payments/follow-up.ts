import type { ContractRequest } from '@/lib/protocol';
import { collectReferences } from '@/lib/verify/references';
import type { JournalEntry } from './journal';

/**
 * After-payment follow-up (Phase 6A).
 *
 * When THIS device funded a request (its journal holds the payer's
 * `pay_instant_native` attempt) and a finalized read shows FINAL_PAID, the pay
 * screen opens the receipt once, carrying the funding hash this device holds
 * as a hint, so the independent verifier starts automatically.
 *
 * Nothing here signs, retries or invents a hash: the hint is only a pointer the
 * verifier re-checks against the chain, and without one the receipt says so.
 */

/** A device's own payment is followed to its receipt only this soon after it started. */
export const FOLLOW_UP_WINDOW_MS = 30 * 60 * 1000;
const CONSUMED_KEY = 'taply.pay-followup.v1';
const MAX_CONSUMED = 50;

export interface FollowUpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The receipt path for a request, with this device's references as hints when it has them. */
export function receiptPath(request: ContractRequest, entries: ReadonlyArray<JournalEntry>): string {
  const base = `/receipt/${request.terms.id}`;
  if (request.status !== 'FINAL_PAID') return base;
  const refs = collectReferences(request, entries, { funding: null, retries: [] });
  if (refs.funding === null) return base;
  const params = new URLSearchParams({ ftx: refs.funding.hash });
  if (refs.complete && refs.retries.length > 0) params.set('rtx', refs.retries.map((r) => r.hash).join(','));
  return `${base}?${params.toString()}`;
}

/** This device's own funding attempt for the request, if it is recent enough to follow up. */
export function ownFundingAttempt(
  request: ContractRequest,
  entries: ReadonlyArray<JournalEntry>,
  nowMs: number,
): JournalEntry | null {
  if (request.status !== 'FINAL_PAID' || request.payerAccountId === null) return null;
  const entry = entries.find(
    (e) =>
      e.requestId === request.terms.id &&
      e.method === 'pay_instant_native' &&
      e.signerAccountId === request.payerAccountId &&
      e.phase !== 'USER_REJECTED',
  );
  if (entry === undefined) return null;
  const age = nowMs - Date.parse(entry.startedAt);
  return age >= 0 && age <= FOLLOW_UP_WINDOW_MS ? entry : null;
}

/**
 * The cashier's side: THIS device created the sale (its journal holds the
 * recipient's own `create_request`), recently enough to follow it to its
 * receipt. The receipt then starts the independent verifier by itself (it
 * finds the funding transaction from public chain data); it never shows
 * Verified Paid on the strength of this navigation.
 */
export function ownSaleCreation(
  request: ContractRequest,
  entries: ReadonlyArray<JournalEntry>,
  nowMs: number,
): JournalEntry | null {
  if (request.status !== 'FINAL_PAID') return null;
  const entry = entries.find(
    (e) =>
      e.requestId === request.terms.id &&
      e.method === 'create_request' &&
      e.signerAccountId === request.terms.creatorAccountId &&
      e.phase !== 'USER_REJECTED',
  );
  if (entry === undefined) return null;
  const age = nowMs - Date.parse(entry.startedAt);
  return age >= 0 && age <= FOLLOW_UP_WINDOW_MS ? entry : null;
}

function consumed(storage: FollowUpStorage): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(CONSUMED_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * True exactly once per attempt (per tab): the caller then opens the receipt.
 * Without storage it never fires, so a reload cannot cause a navigation loop.
 */
export function claimFollowUp(storage: FollowUpStorage | null, entry: JournalEntry): boolean {
  if (storage === null) return false;
  const key = `${entry.requestId}:${entry.startedAt}`;
  const seen = consumed(storage);
  if (seen.includes(key)) return false;
  try {
    storage.setItem(CONSUMED_KEY, JSON.stringify([...seen, key].slice(-MAX_CONSUMED)));
  } catch {
    return false;
  }
  return true;
}

export function sessionFollowUpStorage(): FollowUpStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
