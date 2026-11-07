import { AccountIdSchema } from '@/lib/protocol';

/**
 * Hand-off from a planning tool (recurring template, Split Pay) to the normal
 * request form at /request/new. It PRE-FILLS the form; it never creates,
 * reviews or signs anything. The person still taps Review and approves in
 * their own wallet, exactly as for a hand-typed request.
 *
 * Amounts travel as exact base units (yoctoNEAR) and are shown as an exact
 * decimal, so nothing is rounded on the way.
 */

export const MEMO_MAX_BYTES = 256;
const U128_MAX = (1n << 128n) - 1n;
const SOURCE_ID = /^[A-Za-z0-9-]{8,64}$/;
const SOURCE_KEY = /^[A-Za-z0-9_.:-]{1,40}$/;

export type HandoffKind = 'recurring' | 'split';

export interface HandoffSource {
  readonly kind: HandoffKind;
  /** Template or group ID. */
  readonly id: string;
  /** Occurrence date (YYYY-MM-DD) or participant ID. */
  readonly key: string;
}

export interface Prefill {
  readonly amountBaseUnits: string;
  readonly memo: string;
  readonly payer: string | null;
  readonly source: HandoffSource;
}

/** Exact decimal for base units: no rounding, no grouping, trailing zeros trimmed. */
export function baseUnitsToDecimal(units: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)$/.test(units)) throw new Error('baseUnitsToDecimal: not a base-unit string');
  const padded = units.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '');
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

export function buildPrefillLink(prefill: Prefill): string {
  const params = new URLSearchParams();
  params.set('amountYocto', prefill.amountBaseUnits);
  if (prefill.memo !== '') params.set('memo', prefill.memo);
  if (prefill.payer !== null) params.set('payer', prefill.payer);
  params.set('from', `${prefill.source.kind}:${prefill.source.id}:${prefill.source.key}`);
  return `/request/new?${params.toString()}`;
}

/** Strict parse of a pre-fill link. Anything odd returns null and the form starts empty. */
export function parsePrefill(search: string): Prefill | null {
  const params = new URLSearchParams(search);
  const amount = params.get('amountYocto');
  const from = params.get('from');
  if (amount === null || from === null) return null;
  if (!/^[1-9][0-9]{0,38}$/.test(amount) || BigInt(amount) > U128_MAX) return null;
  const memo = params.get('memo') ?? '';
  if (new TextEncoder().encode(memo).length > MEMO_MAX_BYTES) return null;
  const payerRaw = params.get('payer');
  if (payerRaw !== null && !AccountIdSchema.safeParse(payerRaw).success) return null;
  const parts = from.split(':');
  if (parts.length < 3) return null;
  const [kind, id] = parts as [string, string];
  const key = parts.slice(2).join(':');
  if ((kind !== 'recurring' && kind !== 'split') || !SOURCE_ID.test(id) || !SOURCE_KEY.test(key)) return null;
  return { amountBaseUnits: amount, memo, payer: payerRaw, source: { kind, id, key } };
}
