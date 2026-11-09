/**
 * Passphrase UI guidance. This is NOT cryptography and NOT the policy itself:
 * the vault enforces its own rule (>= MIN_PASSWORD_LENGTH characters, <= 1024 UTF-8 bytes). This
 * mirrors that rule for instant feedback and gives a rough strength hint.
 */
import { MIN_PASSWORD_LENGTH } from '@taply/near-client';

/** Local unlock password, Phantom-style; recovery is the 12-word phrase. */
export const MIN_PASSPHRASE_CHARS = MIN_PASSWORD_LENGTH;
export const MAX_PASSPHRASE_BYTES = 1024;

export type PassphraseProblem = 'too_short' | 'too_long' | null;
export type PassphraseStrength = 'weak' | 'fair' | 'strong' | 'excellent';

export function passphraseProblem(value: string): PassphraseProblem {
  if (value.length < MIN_PASSPHRASE_CHARS) return 'too_short';
  if (new TextEncoder().encode(value).length > MAX_PASSPHRASE_BYTES) return 'too_long';
  return null;
}

/** Heuristic only: length dominates; variety and distinct characters add a little. */
export function passphraseStrength(value: string): PassphraseStrength {
  if (value.length < MIN_PASSPHRASE_CHARS) return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  const distinct = new Set(value).size;
  if (distinct < 6) return 'weak';
  let score = value.length >= 20 ? 3 : value.length >= 12 ? 2 : 1;
  if (classes >= 3) score += 1;
  if (/\s/.test(value.trim()) && value.trim().split(/\s+/).length >= 4) score += 1;
  if (score >= 4) return 'excellent';
  if (score === 3) return 'strong';
  return 'fair';
}
