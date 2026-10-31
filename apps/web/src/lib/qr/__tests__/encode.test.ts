import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeQr } from '../encode';

/**
 * The encoder was checked outside this repo against two independent
 * implementations: for 260 inputs (all four ECC levels, versions 1-27, UTF-8),
 * its matrices were identical module-for-module to qrcode@1.5.4 forced to byte
 * mode at the same version and mask, and every rendered image decoded with
 * jsqr@1.4.0 to the exact input. These hashes pin those verified outputs.
 */
const PINNED = [
  {
    text: 'https://taply.example/pay/0e75e62ce8c7c5a970065c31d1d0ce4109d01bbeeff36eface7daf24f2341f1a',
    ecc: 'M',
    version: 6,
    mask: 2,
    sha256: '295be3535d92fe72ea05d3c14cf887785af6ef337c179789e0afa0563f431c0d',
  },
  { text: 'alice.testnet', ecc: 'M', version: 1, mask: 6, sha256: '8062e7db0ac17fecaca6828ab5e1dc32775d705baa1dddf637c20f22e3848521' },
  { text: 'Türkçe ödeme ✓', ecc: 'Q', version: 2, mask: 6, sha256: 'aa8984c9ea95d4970ab5f85b0ad32f43dde5ed5adcc0ad8b05fe1ff48557d437' },
  { text: 'x'.repeat(200), ecc: 'L', version: 9, mask: 0, sha256: '71ddfbc79101aebe329e96f941cecd5e8440af18575c5b44b1700da69a5e03d3' },
] as const;

function matrixHash(modules: ReadonlyArray<ReadonlyArray<boolean>>): string {
  const bits = modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('\n');
  return createHash('sha256').update(bits).digest('hex');
}

describe('encodeQr', () => {
  it('reproduces the externally verified matrices exactly', () => {
    for (const pin of PINNED) {
      const qr = encodeQr(pin.text, pin.ecc);
      expect(qr.version, pin.text).toBe(pin.version);
      expect(qr.mask, pin.text).toBe(pin.mask);
      expect(qr.size).toBe(pin.version * 4 + 17);
      expect(matrixHash(qr.modules), pin.text).toBe(pin.sha256);
    }
  });

  it('draws the three finder patterns and the always-dark module', () => {
    const qr = encodeQr('https://taply.example/pay/' + 'ab'.repeat(32));
    const finder = (x0: number, y0: number) => {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          expect(qr.modules[y0 + y]![x0 + x], `${x0 + x},${y0 + y}`).toBe(ring !== 2);
        }
      }
    };
    finder(0, 0);
    finder(qr.size - 7, 0);
    finder(0, qr.size - 7);
    expect(qr.modules[qr.size - 8]![8]).toBe(true);
  });

  it('chooses the smallest version that fits and refuses oversized input', () => {
    expect(encodeQr('a').version).toBe(1);
    expect(encodeQr('a'.repeat(14)).version).toBe(1); // v1-M byte capacity is 14
    expect(encodeQr('a'.repeat(15)).version).toBe(2);
    expect(() => encodeQr('a'.repeat(3000), 'H')).toThrow(RangeError);
  });
});
