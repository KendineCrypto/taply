import { keccak_256 } from '@noble/hashes/sha3';
import type { OriginAsset } from './allowlist';

/**
 * Refund address checks. 1Click refunds the origin-chain deposit to `refundTo`
 * (refundType ORIGIN_CHAIN), so a wrong address loses the customer's money.
 *
 * EVM (Base): 0x + 40 hex. All-lowercase or all-uppercase is accepted as
 * unchecksummed; mixed case must pass EIP-55. The zero address and the
 * known token contract are refused.
 */
export type RefundCheck = { readonly ok: true; readonly address: string } | { readonly ok: false; readonly reason: 'format' | 'checksum' | 'forbidden' };

const ZERO = '0x0000000000000000000000000000000000000000';

export function eip55Checksum(lowerHex40: string): string {
  const hash = keccak_256(new TextEncoder().encode(lowerHex40));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    const c = lowerHex40[i]!;
    out += nibble >= 8 ? c.toUpperCase() : c;
  }
  return out;
}

export function validateEvmAddress(input: unknown): RefundCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'format' };
  const value = input.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return { ok: false, reason: 'format' };
  const body = value.slice(2);
  const lower = body.toLowerCase();
  const mixed = body !== lower && body !== body.toUpperCase();
  if (mixed && eip55Checksum(lower) !== value) return { ok: false, reason: 'checksum' };
  return { ok: true, address: `0x${lower}` };
}

export function validateRefundAddress(asset: OriginAsset, input: unknown): RefundCheck {
  const result = validateEvmAddress(input);
  if (!result.ok) return result;
  if (result.address === ZERO || result.address === asset.contractAddress) return { ok: false, reason: 'forbidden' };
  return result;
}
