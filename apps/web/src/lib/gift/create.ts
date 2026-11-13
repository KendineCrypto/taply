import { InvalidAmountError, toBaseUnits } from '@/lib/format/amount';
import { MAX_GIFT_MESSAGE_BYTES } from './link';

export type GiftAmountError = 'required' | 'invalid' | 'tooSmall' | 'tooLarge' | 'precision' | 'balance';

/** Defaults the UI uses before (or without) a verified contract config. */
export const PERSONAL_MIN_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
export const PERSONAL_MAX_YOCTO = 100_000_000_000_000_000_000_000_000n; // 100 NEAR (Testnet)
/** Kept free for gas so a reviewed gift can actually be sent. */
export const GIFT_GAS_RESERVE_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

/**
 * Exact decimal -> yoctoNEAR with the gift limits. Never rounds. `extraYocto`
 * is what is attached on top of the gift (the Open Gift record fee) and
 * `availableYocto` is a final balance read, when known.
 */
export function validateGiftAmount(
  input: string,
  limits: { readonly minYocto: bigint; readonly maxYocto: bigint; readonly extraYocto: bigint; readonly availableYocto: bigint | null },
): { readonly ok: true; readonly yocto: string } | { readonly ok: false; readonly error: GiftAmountError } {
  const text = input.trim();
  if (text === '') return { ok: false, error: 'required' };
  const fraction = text.replace(',', '.').split('.')[1];
  if (fraction !== undefined && fraction.length > 24 && /^[0-9]+$/.test(fraction)) return { ok: false, error: 'precision' };
  let yocto: string;
  try {
    yocto = toBaseUnits(text, 24);
  } catch (error) {
    if (error instanceof InvalidAmountError) return { ok: false, error: 'invalid' };
    throw error;
  }
  const value = BigInt(yocto);
  if (value < limits.minYocto) return { ok: false, error: 'tooSmall' };
  if (value > limits.maxYocto) return { ok: false, error: 'tooLarge' };
  if (limits.availableYocto !== null && value + limits.extraYocto + GIFT_GAS_RESERVE_YOCTO > limits.availableYocto) return { ok: false, error: 'balance' };
  return { ok: true, yocto };
}

export function messageBytes(message: string): number {
  return new TextEncoder().encode(message).byteLength;
}

/** Same rule as the contract (and near-client): control characters except newline are refused. */
export function giftMessageError(message: string, maxBytes = MAX_GIFT_MESSAGE_BYTES): 'tooLong' | 'invalid' | null {
  if (messageBytes(message) > maxBytes) return 'tooLong';
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(message)) return 'invalid';
  return null;
}

/** "23h 59m", "4m 05s" — display only. */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}
