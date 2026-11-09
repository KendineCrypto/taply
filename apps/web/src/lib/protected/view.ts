import type { PaymentRequestRead, ReadResult } from '@taply/near-client';
import { PaymentIntentResponseSchema } from '@/lib/protocol';
import type { PaymentIntentResponse } from '@/lib/protocol';
import { IN_FLIGHT_INCIDENT_AFTER_NS, callerRoleFor } from '@/lib/payments/intent';
import type { PaymentView } from '@/lib/payments/intent';

/**
 * Protected Pay twin of `buildPaymentView` (lib/payments/intent.ts).
 *
 * Same rules: every financial projection comes from ONE fresh verified-final
 * RPC read and the chain time of THAT block. Browser time never opens the
 * cancel window or makes release eligible. The envelope is validated with the
 * frozen `PaymentIntentResponseSchema`, which itself refuses contradictory
 * projections (both cancel and release open, retry by the wrong role, ...).
 */
export function buildProtectedView(input: {
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
  const fresh =
    observation.source === 'rpc' && observation.assurance === 'verified_final' && !observation.stale && observation.rpcAvailable;
  if (request === null) {
    return fresh
      ? { kind: 'not_found', observedAtNs: block.timestampNs, verifiedFinal: true }
      : { kind: 'not_found', observedAtNs: block.timestampNs };
  }
  if (request.terms.contractId !== expectedContractId || request.terms.mode !== 'protected') return { kind: 'wrong_contract' };

  const now = BigInt(block.timestampNs);
  const op = request.latestOperation;
  let incident: PaymentIntentResponse['incident'] = null;
  if (request.status.endsWith('_IN_FLIGHT') && op !== null && now - BigInt(op.startedAtNs) > IN_FLIGHT_INCIDENT_AFTER_NS) {
    incident = 'RECONCILIATION_REQUIRED';
  }

  let fundingEligibility: PaymentIntentResponse['fundingEligibility'] = 'UNKNOWN';
  if (request.status !== 'OPEN') fundingEligibility = 'NOT_OPEN';
  else if (now >= BigInt(request.terms.fundingExpiresAtNs)) fundingEligibility = 'EXPIRED';
  else if (fresh) fundingEligibility = 'ELIGIBLE';

  const cutoff = request.status === 'LOCKED' && request.cancelUntilNs !== null ? BigInt(request.cancelUntilNs) : null;
  const cancelWindowOpen = cutoff === null || !fresh ? null : now < cutoff;
  const releaseEligible = cutoff === null || !fresh ? null : now >= cutoff;

  const callerRole = callerRoleFor(request, accountId);
  const payerSide = callerRole === 'payer' || callerRole === 'payer_and_recipient';
  const recipientSide = callerRole === 'recipient' || callerRole === 'payer_and_recipient';
  const retryable =
    fresh &&
    incident === null &&
    op !== null &&
    op.status === 'FAILED' &&
    ((request.status === 'REFUND_FAILED_RECOVERABLE' && op.kind === 'PROTECTED_REFUND' && payerSide) ||
      (request.status === 'RELEASE_FAILED_RECOVERABLE' && op.kind === 'PROTECTED_RELEASE' && recipientSide));

  const candidate: PaymentIntentResponse = {
    observation: { ...observation, data: request },
    fundingEligibility,
    incident,
    derived: {
      callerRole,
      cancelWindowOpen,
      releaseEligible,
      retry: retryable && op !== null
        ? { eligible: true, operationNonce: op.nonce, kind: op.kind }
        : { eligible: false, operationNonce: null, kind: null },
    },
  };
  const parsed = PaymentIntentResponseSchema.safeParse(candidate);
  if (!parsed.success) return { kind: 'inconsistent' };
  return { kind: 'ok', request, response: parsed.data, observedAtNs: block.timestampNs };
}
