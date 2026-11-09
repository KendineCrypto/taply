import { describe, expect, it } from 'vitest';
import { passphraseProblem, passphraseStrength } from '../passphrase';

describe('password guidance (mirrors the vault policy; not cryptography)', () => {
  it('requires at least 8 characters (Phantom-style unlock password) and at most 1024 UTF-8 bytes', () => {
    expect(passphraseProblem('a'.repeat(7))).toBe('too_short');
    expect(passphraseProblem('a'.repeat(8))).toBeNull();
    expect(passphraseProblem('ş'.repeat(600))).toBe('too_long'); // 1200 bytes
  });

  it('rates length and variety; repetitive input stays weak', () => {
    expect(passphraseStrength('short')).toBe('weak');
    expect(passphraseStrength('aaaaaaaaaaaaaaaaaaaa')).toBe('weak');
    expect(passphraseStrength('abcdefgh')).toBe('fair');
    expect(passphraseStrength('Abcdefghijklmnop1')).toBe('strong');
    expect(passphraseStrength('correct horse battery staple 42')).toBe('excellent');
  });
});
