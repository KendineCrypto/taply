import { describe, expect, it } from 'vitest';
import { FIXTURES } from '@/test/chain';
import { requestProvenance } from '../provenance';

const fresh = { source: 'rpc' as const, assurance: 'verified_final' as const, stale: false, rpcAvailable: true };
const { open } = FIXTURES;

describe('requestProvenance', () => {
  it('verified only when every check already enforced by the read path holds', () => {
    const p = requestProvenance({ request: open, observation: fresh, expectedContractId: open.terms.contractId, codeHashVerified: true });
    expect(p.verified).toBe(true);
    expect(p.failed).toEqual([]);
  });
  it('a stale read, unverified code hash or another contract is never "verified"', () => {
    expect(requestProvenance({ request: open, observation: { ...fresh, stale: true }, expectedContractId: open.terms.contractId, codeHashVerified: true }).failed).toEqual(['final_block']);
    expect(requestProvenance({ request: open, observation: fresh, expectedContractId: open.terms.contractId, codeHashVerified: false }).failed).toEqual(['code_hash']);
    expect(requestProvenance({ request: open, observation: { ...fresh, source: 'mock', assurance: 'unverified' }, expectedContractId: 'other.testnet', codeHashVerified: true }).verified).toBe(false);
  });
});
