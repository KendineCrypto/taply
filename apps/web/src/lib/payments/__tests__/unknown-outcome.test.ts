import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/test/chain';
import type { JournalEntry } from '../journal';
import { buildPaymentView } from '../intent';
import { reconcile } from '../submit';

const started = BigInt(FIXTURES.open.createdAtNs);
const entry: JournalEntry = {
  method: 'create_request', network: 'near-testnet',
  contractId: FIXTURES.open.terms.contractId, requestId: FIXTURES.open.terms.id,
  termsHash: FIXTURES.open.termsHash, signerAccountId: FIXTURES.open.recipientAccountId,
  terms: FIXTURES.open.terms, operationNonce: null, phase: 'OUTCOME_UNKNOWN',
  transactionHash: null, startedAt: new Date(Number(started / 1_000_000n)).toISOString(),
  updatedAt: new Date(Number(started / 1_000_000n)).toISOString(),
};

describe('unresolved wallet operations remain fail closed', () => {
  it.each([120n, 300n, 86400n])('missing creation after %s seconds is not proof of failure', seconds => {
    expect(reconcile(entry, { kind: 'not_found', observedAtNs: (started + seconds * 1_000_000_000n).toString() }, started)).toBe('pending');
  });

  it.each(['pay_instant_native', 'cancel_unfunded', 'retry_native_transfer'] as const)('%s cannot be re-signed solely because two minutes elapsed', method => {
    const request = method === 'retry_native_transfer' ? FIXTURES.failed : FIXTURES.openRestricted;
    const view = buildPaymentView({
      read: { observation: { source: 'rpc', assurance: 'verified_final', stale: false, rpcAvailable: true,
        data: { id: request.terms.id, request }, checkedAt: '2026-11-02T00:00:00.000Z',
        observedBlock: { hash: '11111111111111111111111111111113', height: '1000', timestampNs: (started + 300_000_000_000n).toString() } }, error: null },
      expectedContractId: request.terms.contractId, accountId: null,
    });
    expect(reconcile({ ...entry, method, operationNonce: request.latestOperation?.nonce ?? null }, view, started)).toBe('pending');
  });
});
