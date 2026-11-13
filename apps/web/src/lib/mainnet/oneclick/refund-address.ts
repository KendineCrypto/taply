import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha2';
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

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Strict base58 decode (Bitcoin alphabet); null on any invalid character. */
export function base58Decode(text: string): Uint8Array | null {
  if (text.length === 0 || text.length > 64) return null;
  let n = 0n;
  for (const ch of text) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number.parseInt((n & 0xffn).toString(), 10));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

/**
 * Solana: base58 of a 32-byte public key. The all-zero system program and the
 * token mint itself are refused. Whether the key is on the ed25519 curve (a
 * program-derived address cannot sign) is NOT checked here; the UI tells the
 * customer to use a wallet address they control.
 */
export function validateSolanaAddress(input: unknown): RefundCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'format' };
  const value = input.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return { ok: false, reason: 'format' };
  const bytes = base58Decode(value);
  if (bytes === null || bytes.length !== 32) return { ok: false, reason: 'format' };
  if (bytes.every((b) => b === 0)) return { ok: false, reason: 'forbidden' };
  return { ok: true, address: value };
}

/** Tron: base58check of 0x41 + 20 bytes, checksum = first 4 bytes of sha256(sha256(payload)). */
export function validateTronAddress(input: unknown): RefundCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'format' };
  const value = input.trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return { ok: false, reason: 'format' };
  const bytes = base58Decode(value);
  if (bytes === null || bytes.length !== 25 || bytes[0] !== 0x41) return { ok: false, reason: 'format' };
  const payload = bytes.slice(0, 21);
  const check = sha256(sha256(payload)).slice(0, 4);
  if (!check.every((b, i) => b === bytes[21 + i])) return { ok: false, reason: 'checksum' };
  if (payload.slice(1).every((b) => b === 0)) return { ok: false, reason: 'forbidden' };
  return { ok: true, address: value };
}

export function validateRefundAddress(asset: Pick<OriginAsset, 'refundAddressFormat' | 'contractAddress'>, input: unknown): RefundCheck {
  const result =
    asset.refundAddressFormat === 'solana' ? validateSolanaAddress(input)
      : asset.refundAddressFormat === 'tron' ? validateTronAddress(input)
        : validateEvmAddress(input);
  if (!result.ok) return result;
  if (result.address === ZERO || result.address === asset.contractAddress) return { ok: false, reason: 'forbidden' };
  return result;
}
