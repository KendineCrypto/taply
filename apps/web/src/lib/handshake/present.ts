import { calculateSessionCommitment, calculateTermsHash, comparisonCode } from '@/lib/protocol';
import type { HandshakeSession, IntentTerms } from '@/lib/protocol';

/**
 * Pure Handshake presentation (freeze section 6).
 *
 * Inputs are the session snapshot (untrusted coordination data) and the terms
 * this device read independently from the contract. The comparison code is
 * derived HERE, from those terms, with the canonical @taply/shared algorithm.
 * The server's code is only compared against it.
 *
 * There is deliberately no "paid" output: payment status comes from the
 * contract on /pay/<id>, never from a session.
 */

export type HandshakeRole = 'merchant' | 'customer';

export type HandshakePhase =
  | 'waiting' // OPEN, no customer yet
  | 'paired' // customer joined, not reviewed
  | 'reviewed' // customer reviewed exactly these terms
  | 'mismatch' // terms, binding or code disagree: do not pay
  | 'expired'
  | 'closed'
  | 'not_bound'; // draft, or terms not loaded / not bound to this session

export interface HandshakePresentation {
  readonly phase: HandshakePhase;
  /** Derived locally from chain terms; null when the terms carry no session binding. */
  readonly code: string | null;
  /** Presence of the OTHER party, derived from presence data (never a payment state). */
  readonly counterpartConnected: boolean;
  /** The customer may move on to wallet review. Never true for the merchant. */
  readonly customerMayProceed: boolean;
}

/** Local comparison code for terms bound to a session, or null. */
export function localComparisonCode(terms: IntentTerms): string | null {
  const commitment = calculateSessionCommitment(terms);
  return commitment === null ? null : comparisonCode(commitment);
}

export function presentHandshake(input: {
  readonly role: HandshakeRole;
  readonly session: HandshakeSession;
  /** Read from the contract by this device; null while loading or unavailable. */
  readonly chainTerms: IntentTerms | null;
  /** Current chain time (ns, decimal string) for expiry; never the device clock alone. */
  readonly nowNs: string;
}): HandshakePresentation {
  const { role, session, chainTerms } = input;
  const counterpartConnected = role === 'merchant' ? session.presence.payer : session.presence.merchant;
  const base = { counterpartConnected, customerMayProceed: false } as const;

  if (session.state === 'CLOSED') return { ...base, phase: 'closed', code: null };
  if (session.state === 'EXPIRED' || BigInt(input.nowNs) >= BigInt(session.expiresAtNs)) return { ...base, phase: 'expired', code: null };
  if (session.state === 'DRAFT' || chainTerms === null) return { ...base, phase: 'not_bound', code: null };

  const code = localComparisonCode(chainTerms);
  const binding = chainTerms.sessionBinding;
  const consistent =
    code !== null &&
    binding !== null &&
    binding.id === session.id &&
    binding.nonce === session.nonce &&
    binding.expiresAtNs === session.expiresAtNs &&
    session.intentId === chainTerms.id &&
    session.termsHash === calculateTermsHash(chainTerms) &&
    session.comparisonCode === code &&
    chainTerms.merchantAccountId === session.merchantAccountId &&
    chainTerms.creatorAccountId === session.merchantAccountId;
  if (!consistent) return { ...base, phase: 'mismatch', code };

  if (session.state === 'REVIEWED') {
    return { ...base, phase: 'reviewed', code, customerMayProceed: role === 'customer' };
  }
  if (session.state === 'PAIRED') return { ...base, phase: 'paired', code };
  return { ...base, phase: 'waiting', code };
}
