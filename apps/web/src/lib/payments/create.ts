import {
  AccountIdSchema,
  DEFAULT_FUNDING_LIFETIME_NS,
  INTENT_VERSION,
  IntentTermsSchema,
  MAX_FUNDING_LIFETIME_NS,
  calculateRequestId,
  calculateTermsHash,
} from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';
import { InvalidAmountError, toBaseUnits } from '@/lib/format/amount';

/**
 * Instant Pay request creation (contracts/payments/HANDOFF_CLAUDE.md step 2).
 *
 * The recipient is always the connected creator. The creation nonce is 32 random
 * bytes from the platform CSPRNG, generated once and journaled before any wallet
 * opens; the request ID and terms hash come from `@taply/shared`, never from here.
 */

/** Funding windows offered in the form. All are well inside the 24 h contract maximum. */
export const FUNDING_LIFETIMES = {
  '15m': BigInt(DEFAULT_FUNDING_LIFETIME_NS),
  '1h': 3_600_000_000_000n,
  '12h': 43_200_000_000_000n,
} as const;
export type FundingLifetime = keyof typeof FUNDING_LIFETIMES;

export const MEMO_MAX_BYTES = 256;

export function newCreationNonce(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(32));
  if (bytes.length !== 32) throw new Error('nonce source returned the wrong length');
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export type RequestFormError =
  | 'amount_required'
  | 'amount_invalid'
  | 'amount_zero'
  | 'memo_too_long'
  | 'payer_invalid'
  | 'payer_is_recipient';

export interface RequestFormInput {
  readonly amount: string;
  readonly memo: string;
  /** Optional: only this account may pay. Empty means anyone. */
  readonly payer: string;
}

export interface ValidRequestForm {
  readonly amountBaseUnits: string;
  readonly memo: string;
  readonly permittedPayerAccountId: string | null;
}

export function validateRequestForm(
  input: RequestFormInput,
  creatorAccountId: string,
): { readonly ok: true; readonly value: ValidRequestForm } | { readonly ok: false; readonly errors: ReadonlyArray<RequestFormError> } {
  const errors: RequestFormError[] = [];

  let amountBaseUnits = '';
  if (input.amount.trim() === '') errors.push('amount_required');
  else {
    try {
      amountBaseUnits = toBaseUnits(input.amount, 24);
      if (amountBaseUnits === '0') errors.push('amount_zero');
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      errors.push('amount_invalid');
    }
  }

  if (new TextEncoder().encode(input.memo).length > MEMO_MAX_BYTES) errors.push('memo_too_long');

  const payer = input.payer.trim();
  let permittedPayerAccountId: string | null = null;
  if (payer !== '') {
    if (!AccountIdSchema.safeParse(payer).success) errors.push('payer_invalid');
    else if (payer === creatorAccountId) errors.push('payer_is_recipient');
    else permittedPayerAccountId = payer;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { amountBaseUnits, memo: input.memo, permittedPayerAccountId } };
}

/**
 * Exact `taply.intent.v1` Instant terms. `chainNowNs` must be the timestamp of a
 * finalized block (never the browser clock); expiry is relative to it.
 */
export function buildInstantTerms(input: {
  readonly contractId: string;
  readonly creatorAccountId: string;
  readonly creationNonce: string;
  readonly form: ValidRequestForm;
  readonly chainNowNs: string;
  readonly lifetime: FundingLifetime;
}): { readonly terms: IntentTerms; readonly termsHash: string } {
  const lifetimeNs = FUNDING_LIFETIMES[input.lifetime];
  if (lifetimeNs <= 0n || lifetimeNs > MAX_FUNDING_LIFETIME_NS) throw new RangeError('funding lifetime out of range');
  const id = calculateRequestId({
    contractId: input.contractId,
    creationNonce: input.creationNonce,
    creatorAccountId: input.creatorAccountId,
    network: 'near-testnet',
  });
  const terms = IntentTermsSchema.parse({
    schemaVersion: INTENT_VERSION,
    id,
    network: 'near-testnet',
    contractId: input.contractId,
    creationNonce: input.creationNonce,
    creatorAccountId: input.creatorAccountId,
    assetId: 'near:native',
    amountBaseUnits: input.form.amountBaseUnits,
    mode: 'instant',
    cancelDurationNs: null,
    fundingExpiresAtNs: (BigInt(input.chainNowNs) + lifetimeNs).toString(),
    permittedPayerAccountId: input.form.permittedPayerAccountId,
    merchantAccountId: null,
    memo: input.form.memo,
    sessionBinding: null,
  });
  return { terms, termsHash: calculateTermsHash(terms) };
}

/** The canonical share link. The QR code encodes exactly this string. */
export function payLink(origin: string, requestId: string): string {
  const url = new URL(origin);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('share links must use https');
  }
  return `${url.origin}/pay/${requestId}`;
}
