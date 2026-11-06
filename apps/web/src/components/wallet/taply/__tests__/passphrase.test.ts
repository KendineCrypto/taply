import { describe, expect, it } from 'vitest';
import { passphraseProblem, passphraseStrength } from '../passphrase';

describe('passphrase guidance (mirrors the vault policy; not cryptography)', () => {
  it('requires at least 16 characters and at most 1024 UTF-8 bytes', () => {
    expect(passphraseProblem('a'.repeat(15))).toBe('too_short');
    expect(passphraseProblem('a'.repeat(16))).toBeNull();
    expect(passphraseProblem('ş'.repeat(600))).toBe('too_long'); // 1200 bytes
  });

  it('rates length and variety; repetitive input stays weak', () => {
    expect(passphraseStrength('short')).toBe('weak');
    expect(passphraseStrength('aaaaaaaaaaaaaaaaaaaa')).toBe('weak');
    expect(passphraseStrength('abcdefghijklmnop')).toBe('fair');
    expect(passphraseStrength('Abcdefghijklmnop1234')).toBe('strong');
    expect(passphraseStrength('correct horse battery staple 42')).toBe('excellent');
  });
});
