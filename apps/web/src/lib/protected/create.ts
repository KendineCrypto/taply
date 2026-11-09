import {
  DEFAULT_FUNDING_LIFETIME_NS,
  INTENT_VERSION,
  IntentTermsSchema,
  MAX_CANCEL_DURATION_NS,
  MIN_CANCEL_DURATION_NS,
  calculateRequestId,
  calculateTermsHash,
} from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';
import type { ValidRequestForm } from '@/lib/payments/create';

/**
 * Protected request terms (taply.intent.v1, mode "protected").
 *
 * The cancellation window is signed into the immutable terms; the cutoff
 * itself does not exist until the payment locks on chain (freeze section 4).
 */
export const CANCEL_WINDOWS = {
  '60s': 60_000_000_000n,
  '5m': 300_000_000_000n,
  '15m': 900_000_000_000n,
  '1h': 3_600_000_000_000n,
} as const;
export type CancelWindow = keyof typeof CANCEL_WINDOWS;

export function buildProtectedTerms(input: {
  readonly contractId: string;
  readonly creatorAccountId: string;
  readonly creationNonce: string;
  readonly form: ValidRequestForm;
  /** Timestamp of a fresh finalized block, never the browser clock. */
  readonly chainNowNs: string;
  readonly window: CancelWindow;
}): { readonly terms: IntentTerms; readonly termsHash: string } {
  const duration = CANCEL_WINDOWS[input.window];
  if (duration < MIN_CANCEL_DURATION_NS || duration > MAX_CANCEL_DURATION_NS) throw new RangeError('cancel window out of range');
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
    mode: 'protected',
    cancelDurationNs: duration.toString(),
    fundingExpiresAtNs: (BigInt(input.chainNowNs) + BigInt(DEFAULT_FUNDING_LIFETIME_NS)).toString(),
    permittedPayerAccountId: input.form.permittedPayerAccountId,
    merchantAccountId: null,
    memo: input.form.memo,
    sessionBinding: null,
  });
  return { terms, termsHash: calculateTermsHash(terms) };
}
