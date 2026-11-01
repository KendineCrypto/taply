import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateRequestId, calculateTermsHash } from '../../../packages/shared/dist/index.js';
import { pilotReaderFromClient, PILOT_CONTRACT } from '../src/pilot-reader.mts';

function fixture() {
  const request = JSON.parse(readFileSync(new URL('../../../packages/near-client/test/fixtures/request-open.json', import.meta.url), 'utf8'));
  request.terms.contractId = PILOT_CONTRACT;
  const { contractId, creationNonce, creatorAccountId, network } = request.terms;
  request.terms.id = calculateRequestId({ contractId, creationNonce, creatorAccountId, network });
  request.termsHash = calculateTermsHash(request.terms);
  const result: any = { error: null, observation: { source: 'rpc', assurance: 'verified_final',
    stale: false, rpcAvailable: true, observedBlock: { hash: '1'.repeat(32), height: '1', timestampNs: request.createdAtNs },
    checkedAt: '2026-11-01T00:00:00.000Z', data: { id: request.terms.id, request } } };
  return { request, result, reader: pilotReaderFromClient({ readPaymentRequest: async () => result }) };
}
test('canonical pilot terms have explicit provenance but cannot bind Handshake', async () => {
  const f = fixture(); const result = await f.reader.read(f.request.terms.id);
  assert.equal(result.request.terms.merchantAccountId, null);
  assert.equal(result.provenance.evidenceKind, 'CANONICAL_REQUEST_NOT_PAYOUT_RECEIPT');
  await assert.rejects(f.reader.readCanonicalRequest(f.request.terms.id), /VERIFICATION_UNAVAILABLE/);
});
test('RPC outage, mock, stale, missing/ambiguous evidence and mismatch fail closed', async () => {
  for (const mutate of [
    (r: any) => { r.error = { code: 'RPC_TIMEOUT' }; },
    (r: any) => { r.observation.source = 'mock'; },
    (r: any) => { r.observation.stale = true; },
    (r: any) => { r.observation.rpcAvailable = false; },
    (r: any) => { r.observation.observedBlock = null; },
    (r: any) => { r.observation.assurance = 'mismatch'; },
    (r: any) => { r.observation.data.request = null; },
    (r: any) => { r.observation.data.id = '0'.repeat(64); },
  ]) { const f = fixture(); mutate(f.result); await assert.rejects(f.reader.read(f.request.terms.id)); }
});
