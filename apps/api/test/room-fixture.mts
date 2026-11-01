import { SessionEngine, MemorySessionPersistence, type SessionPersistence } from '../src/sessions.mts';
import { calculateRequestId, calculateTermsHash, calculateSessionCommitment, type ContractRequest, type IntentTerms } from '../../../packages/shared/dist/index.js';

// Account authentication and finalized request evidence are SYNTHETIC. No keys,
// wallet, RPC, listener or transaction. Production composition never uses this.
export async function roomFixture(store: SessionPersistence = new MemorySessionPersistence()) {
  let now = 1793500000000;
  const credentials = new Map([['merchant-token', 'merchant.testnet'], ['payer-token', 'payer.testnet'],
    ['payer-new-token', 'payer.testnet'], ['outsider-token', 'outsider.testnet']]);
  const deps = { contractId: 'next.testnet', now: () => now,
    authenticate: async (credential: unknown) => {
      const accountId = credentials.get(String(credential)); if (!accountId) throw Error('AUTH_REQUIRED'); return { accountId };
    }, readCanonicalRequest: async () => structuredClone(record) };
  const engine = new SessionEngine(store, deps);
  const created = await engine.create('merchant-token', 'room_create_key_0001');
  const id = created.session.id;
  const terms: IntentTerms = { schemaVersion: 'taply.intent.v1', network: 'near-testnet', contractId: 'next.testnet',
    id: '', creatorAccountId: 'merchant.testnet', creationNonce: 'a'.repeat(64), assetId: 'near:native',
    amountBaseUnits: '1000', mode: 'instant', cancelDurationNs: null, memo: '',
    fundingExpiresAtNs: String(BigInt(now + 180000) * 1000000n), merchantAccountId: 'merchant.testnet', permittedPayerAccountId: 'payer.testnet',
    sessionBinding: { id, nonce: created.session.nonce, expiresAtNs: created.session.expiresAtNs } };
  const { contractId, creatorAccountId, creationNonce, network } = terms;
  terms.id = calculateRequestId({ contractId, creatorAccountId, creationNonce, network });
  const record: ContractRequest = { terms, termsHash: calculateTermsHash(terms), sessionCommitment: calculateSessionCommitment(terms),
    recipientAccountId: 'merchant.testnet', status: 'OPEN', revision: '1', createdAtNs: String(BigInt(now) * 1000000n),
    payerAccountId: null, fundedAtNs: null, cancelUntilNs: null, settlementBranch: null, latestOperation: null };
  const bind = () => engine.bind('merchant-token', id, 'room_bind_key_0001', { intentId: terms.id, termsHash: record.termsHash });
  const join = () => engine.join('payer-token', id, 'room_join_key_0001', { joinToken: created.joinToken });
  const review = (credential: string) => engine.review(credential, id, 'room_review_key_0001', { termsHash: record.termsHash });
  const ready = async () => { await bind(); await join(); await review('merchant-token'); await review('payer-token'); };
  const sync = () => engine.sync('payer-token', id);
  return { engine, store, deps, credentials, created, id, record, bind, join, review, ready, sync,
    now: () => now, advance: (ms: number) => { now += ms; } };
}
