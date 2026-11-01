import { buildClient } from '../../../packages/near-client/dist/client.js';
import { ContractRequestSchema, HashHexSchema } from '../../../packages/shared/dist/index.js';
import type { NearTestnetClient } from '../../../packages/near-client/dist/types.js';

export const PILOT_CONTRACT = 'taply-pay-pilot-1.testnet';
export const PILOT_CODE_HASH = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';

/** Read-only production factory. Network/genesis/code hash are checked by the
 * existing near-client at the same finalized block as get_request. No signer. */
export function createPilotReader() {
  const client = buildClient({ network: 'near-testnet', rpcUrl: 'https://rpc.testnet.near.org',
    rpcProviderId: 'near-public-testnet', timeoutMs: 10000,
    contract: { accountId: PILOT_CONTRACT, expectedCodeHash: PILOT_CODE_HASH } },
  (url, init) => globalThis.fetch(url, init), false, () => new Date());
  return pilotReaderFromClient(client);
}

/** Dependency-injection seam for tests; supplied reader is a trusted boundary. */
export function pilotReaderFromClient(client: Pick<NearTestnetClient, 'readPaymentRequest'>) {
  const read = async (id: string) => {
    HashHexSchema.parse(id);
    const result = await client.readPaymentRequest(id); const o = result.observation;
    if (result.error || o.source !== 'rpc' || o.assurance !== 'verified_final' || !o.rpcAvailable
      || o.stale || o.observedBlock === null || o.data === null) throw Error('VERIFICATION_UNAVAILABLE');
    if (o.data.id !== id || o.data.request === null) throw Error('REQUEST_NOT_FOUND');
    const request = ContractRequestSchema.parse(o.data.request);
    if (request.terms.id !== id || request.terms.contractId !== PILOT_CONTRACT) throw Error('TERMS_MISMATCH');
    // A bound record from this approved pilot is impossible. Refuse inconsistent evidence.
    if (request.terms.merchantAccountId !== null || request.terms.sessionBinding !== null)
      throw Error('MERCHANT_BINDING_INVALID');
    return { request, provenance: { network: 'near-testnet' as const, contractId: PILOT_CONTRACT,
      codeHash: PILOT_CODE_HASH, source: 'rpc' as const, observedBlock: o.observedBlock,
      checkedAt: o.checkedAt, trustModel: 'configured-rpc' as const,
      evidenceKind: 'CANONICAL_REQUEST_NOT_PAYOUT_RECEIPT' as const } };
  };
  return { read,
    async readCanonicalRequest(id: string): Promise<never> {
      await read(id);
      // Never downgrade a bound request to the pilot's ordinary Instant request.
      throw Error('VERIFICATION_UNAVAILABLE');
    },
  };
}
