import type { ChainObservation, ContractRequest } from '@/lib/protocol';

/**
 * "Verified request" provenance (original Verified Requests concept).
 *
 * Every check below was ALREADY enforced by the read path; this only reports
 * them so a person can tell a random link from a request read from the chain.
 * It says nothing about legal identity, reputation or KYC, and nothing about
 * payment: payment proof is the separate receipt verifier.
 */
export type ProvenanceCheck = 'approved_contract' | 'code_hash' | 'final_block' | 'terms_hash' | 'testnet';

export interface RequestProvenance {
  readonly verified: boolean;
  readonly passed: ReadonlyArray<ProvenanceCheck>;
  readonly failed: ReadonlyArray<ProvenanceCheck>;
}

export function requestProvenance(input: {
  readonly request: ContractRequest;
  readonly observation: Pick<ChainObservation<unknown>, 'source' | 'assurance' | 'stale' | 'rpcAvailable'>;
  readonly expectedContractId: string;
  /** The contract's code hash matched the approved hash at a final block (payments setup check). */
  readonly codeHashVerified: boolean;
}): RequestProvenance {
  const o = input.observation;
  const results: Array<[ProvenanceCheck, boolean]> = [
    ['testnet', input.request.terms.network === 'near-testnet'],
    ['approved_contract', input.request.terms.contractId === input.expectedContractId],
    ['code_hash', input.codeHashVerified],
    ['final_block', o.source === 'rpc' && o.assurance === 'verified_final' && !o.stale && o.rpcAvailable],
    // ContractRequestSchema (shared) already refuses a record whose termsHash differs from its terms.
    ['terms_hash', true],
  ];
  const passed = results.filter(([, ok]) => ok).map(([c]) => c);
  const failed = results.filter(([, ok]) => !ok).map(([c]) => c);
  return { verified: failed.length === 0, passed, failed };
}
