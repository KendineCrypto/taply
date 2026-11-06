import type { PaymentRequestRead, ReadResult, RpcErrorCode } from '@taply/near-client';
import { PaymentIntentResponseSchema } from '@/lib/protocol';
import type { CallerRole, ContractRequest, PaymentIntentResponse } from '@/lib/protocol';

/**
 * Builds the frozen `PaymentIntentResponse` envelope from ONE finalized contract
 * read, entirely client-side (there is no Taply API yet).
 *
 * Rules (freeze sections 3 and 4, PAYMENT_STATE_MACHINE.md):
 *  - Financial projections (funding eligibility, retry) are computed only from a
 *    fresh `verified_final` RPC observation and the chain time of THAT block.
 *    Browser time is never used.
 *  - The result is validated with the shared `PaymentIntentResponseSchema`. If it
 *    does not validate, the view fails closed (`inconsistent`) instead of showing
 *    a partially trusted state.
 *  - Callback status is never inferred. A long-running PAYOUT_IN_FLIGHT becomes
 *    `RECONCILIATION_REQUIRED`: the transfer may already have happened, so nothing
 *    may be retried or paid again (ADR-001 callback-stall limitation).
 */

/** In flight longer than this, by chain time, is reported as an unresolved incident. */
export const IN_FLIGHT_INCIDENT_AFTER_NS = 300_000_000_000n; // 5 minutes

export type PaymentView =
  | { readonly kind: 'unavailable'; readonly error: RpcErrorCode | null }
  /**
   * `verifiedFinal` is present only when the absence was observed at a verified
   * final RPC block that is neither stale nor degraded. Absent means untrusted.
   */
  | { readonly kind: 'not_found'; readonly observedAtNs: string; readonly verifiedFinal?: true }
  | { readonly kind: 'wrong_contract' }
  | { readonly kind: 'inconsistent' }
  | {
      readonly kind: 'ok';
      readonly request: ContractRequest;
      readonly response: PaymentIntentResponse;
      /** Chain time of the observed final block (ns), for expiry and age display. */
      readonly observedAtNs: string;
    };

export function callerRoleFor(request: ContractRequest, accountId: string | null): CallerRole {
  if (accountId === null) return 'anonymous';
  const payer = request.payerAccountId === accountId;
  const recipient = request.recipientAccountId === accountId;
  if (payer && recipient) return 'payer_and_recipient';
  if (recipient) return 'recipient';
  if (payer) return 'payer';
  // A restricted payer who has not paid yet is still the intended payer.
  if (request.status === 'OPEN' && request.terms.permittedPayerAccountId === accountId) return 'payer';
  return 'observer';
}

export function buildPaymentView(input: {
  readonly read: ReadResult<PaymentRequestRead>;
  readonly expectedContractId: string;
  readonly accountId: string | null;
}): PaymentView {
  const { read, expectedContractId, accountId } = input;
  const { observation, error } = read;
  if (error !== null || observation.data === null) return { kind: 'unavailable', error: error?.code ?? null };

  const block = observation.observedBlock;
  const request = observation.data.request;
  if (block === null) return { kind: 'unavailable', error: null };
  if (request === null) {
    const verifiedFinal = observation.source === 'rpc' && observation.assurance === 'verified_final' && !observation.stale && observation.rpcAvailable;
    return verifiedFinal
      ? { kind: 'not_found', observedAtNs: block.timestampNs, verifiedFinal: true }
      : { kind: 'not_found', observedAtNs: block.timestampNs };
  }
  if (request.terms.contractId !== expectedContractId) return { kind: 'wrong_contract' };

  const now = BigInt(block.timestampNs);
  const fresh =
    observation.source === 'rpc' &&
    observation.assurance === 'verified_final' &&
    !observation.stale &&
    observation.rpcAvailable;

  let incident: PaymentIntentResponse['incident'] = null;
  const op = request.latestOperation;
  if (request.status === 'PAYOUT_IN_FLIGHT' && op !== null && now - BigInt(op.startedAtNs) > IN_FLIGHT_INCIDENT_AFTER_NS) {
    incident = 'RECONCILIATION_REQUIRED';
  }

  let fundingEligibility: PaymentIntentResponse['fundingEligibility'] = 'UNKNOWN';
  if (request.status !== 'OPEN') fundingEligibility = 'NOT_OPEN';
  else if (request.terms.mode !== 'instant') fundingEligibility = 'UNSUPPORTED';
  else if (now >= BigInt(request.terms.fundingExpiresAtNs)) fundingEligibility = 'EXPIRED';
  else if (fresh) fundingEligibility = 'ELIGIBLE';

  const callerRole = callerRoleFor(request, accountId);
  const retryable =
    fresh &&
    incident === null &&
    request.status === 'PAYOUT_FAILED_RECOVERABLE' &&
    op !== null &&
    op.status === 'FAILED' &&
    op.kind === 'INSTANT_PAYOUT' &&
    (callerRole === 'recipient' || callerRole === 'payer_and_recipient');

  const candidate: PaymentIntentResponse = {
    observation: { ...observation, data: request },
    fundingEligibility,
    incident,
    derived: {
      callerRole,
      // Instant Pay has no cancel window or release step.
      cancelWindowOpen: null,
      releaseEligible: null,
      retry: retryable
        ? { eligible: true, operationNonce: op.nonce, kind: op.kind }
        : { eligible: false, operationNonce: null, kind: null },
    },
  };

  const parsed = PaymentIntentResponseSchema.safeParse(candidate);
  if (!parsed.success) return { kind: 'inconsistent' };
  return { kind: 'ok', request, response: parsed.data, observedAtNs: block.timestampNs };
}
