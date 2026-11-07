/**
 * Archived verification records: earlier verifier outputs kept as history.
 *
 * An archived record is NOT a chain read. It says what Taply's verifier
 * concluded at `checkedAt`, through `rpcProviderId`. It never turns on the
 * Verified Paid ribbon, never sets a receipt status, and is only shown next to
 * (never instead of) the live result, labelled as archived.
 *
 * The full JSON is served unchanged at `jsonPath` (a byte-identical copy of
 * `docs/evidence/`, enforced by a test). The summary below is checked against
 * that JSON by the same test, so the two cannot drift.
 */
export interface ArchivedVerification {
  readonly requestId: string;
  readonly termsHash: string;
  readonly contractId: string;
  readonly contractCodeHash: string;
  readonly network: 'near-testnet';
  readonly amountBaseUnits: string;
  readonly payerAccountId: string;
  readonly recipientAccountId: string;
  readonly fundingTransactionHash: string;
  readonly stateBlockHeight: string;
  readonly rpcProviderId: string;
  /** When the verifier ran (UTC, ISO 8601). */
  readonly checkedAt: string;
  /** Same-origin path to the unchanged verifier JSON. */
  readonly jsonPath: string;
}

export const ARCHIVED_VERIFICATIONS: ReadonlyArray<ArchivedVerification> = [
  {
    requestId: '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502',
    termsHash: '11903572703c42b9b2f0b110f861a83eed84d3cdeac955027b2bc241836888f3',
    contractId: 'taply-pay-pilot-1.testnet',
    contractCodeHash: 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B',
    network: 'near-testnet',
    amountBaseUnits: '100000000000000000000000',
    payerAccountId: 'taply-pilot-funder-1101.testnet',
    recipientAccountId: 'taplytest.testnet',
    fundingTransactionHash: 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su',
    stateBlockHeight: '275768214',
    rpcProviderId: 'fastnear-testnet',
    checkedAt: '2026-11-01T15:36:30.100Z',
    jsonPath: '/evidence/instant-pay-2026-11-01-receipt.json',
  },
];

/**
 * The archived record for this request, only when it matches the build's
 * contract, the approved code hash AND the terms the contract reports now.
 * Any difference returns null: an archive for other terms is not shown.
 */
export function archivedVerificationFor(input: {
  readonly requestId: string;
  readonly contractId: string;
  readonly approvedCodeHash: string;
  /** Terms hash read from the contract in this session, or null if no read succeeded. */
  readonly liveTermsHash: string | null;
}): ArchivedVerification | null {
  const record = ARCHIVED_VERIFICATIONS.find((r) => r.requestId === input.requestId) ?? null;
  if (record === null) return null;
  if (record.contractId !== input.contractId || record.contractCodeHash !== input.approvedCodeHash) return null;
  if (input.liveTermsHash !== null && input.liveTermsHash !== record.termsHash) return null;
  return record;
}
