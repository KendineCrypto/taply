import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calculateRequestId, calculateTermsHash, ContractRequestSchema } from '@taply/shared';
import { createReviewedWalletBackend, APPROVED_PAYMENT_CODE_HASH } from '../dist/wallet-backend.js';
import { buildClient } from '../dist/client.js';
import { prepareCreateRequest, preparePayInstantNative, prepareCancelUnfunded, prepareRetryNativeTransfer } from '../dist/contract.js';
import { signerFixture } from './wallet-signer-fixture.mjs';

for (const method of ['create_request', 'pay_instant_native', 'cancel_unfunded', 'retry_native_transfer']) {
  test(`SDK adapter reuses ${method} preparation, exact args/deposit/gas and never claims Verified Paid`, async () => {
    const f = await signerFixture(); const contractId = 'taply-pay-pilot-1.testnet';
    f.config.contract = { accountId: contractId, expectedCodeHash: APPROVED_PAYMENT_CODE_HASH };
    const deployed = {
      schemaVersion: 'taply.contract-config.v1', contractVersion: '0.4.0', network: 'near-testnet', contractId,
      intentVersion: 'taply.intent.v1', eventVersion: '0.4.0', quoteVersion: '1',
      capabilities: { instantNative: true, protectedPay: false, handshake: false, merchantProfiles: false, nep141: false, sponsoredGas: false },
      storageByteCostYocto: '10000000000000000000', gas: { createRequest: '30000000000000', payInstantNative: '50000000000000', retryNativeTransfer: '50000000000000', cancelUnfunded: '15000000000000', callback: '15000000000000' },
      storageRefundPolicy: 'PERMANENT_RECORD_NO_WITHDRAWAL', unknownCallbackPolicy: 'IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE', testFaultBuild: false,
    };
    const record = JSON.parse(readFileSync(new URL(`./fixtures/${method === 'retry_native_transfer' ? 'request-payout-failed' : 'request-open'}.json`, import.meta.url), 'utf8'));
    record.terms.contractId = contractId;
    record.terms.creatorAccountId = record.recipientAccountId = method === 'pay_instant_native' ? 'recipient.testnet' : f.identity.accountId;
    // Move the entire captured lifecycle together. Moving only expiry eventually
    // exceeds the schema's 24-hour lifetime as the wall clock advances.
    const shift = BigInt(f.state.now - 60000) * 1000000n - BigInt(record.createdAtNs);
    record.createdAtNs = (BigInt(record.createdAtNs) + shift).toString();
    if (record.fundedAtNs !== null) record.fundedAtNs = (BigInt(record.fundedAtNs) + shift).toString();
    if (record.latestOperation) {
      record.latestOperation.startedAtNs = (BigInt(record.latestOperation.startedAtNs) + shift).toString();
      record.latestOperation.resolvedAtNs = (BigInt(record.latestOperation.resolvedAtNs) + shift).toString();
    }
    record.terms.fundingExpiresAtNs = (BigInt(f.state.now + 900000) * 1000000n).toString();
    const { creationNonce, creatorAccountId, network } = record.terms;
    record.terms.id = calculateRequestId({ contractId, creationNonce, creatorAccountId, network });
    record.termsHash = calculateTermsHash(record.terms);
    if (record.latestOperation) record.latestOperation.destinationAccountId = record.recipientAccountId;
    ContractRequestSchema.parse(record);
    const quote = { quoteVersion: '1', requestId: record.terms.id, termsHash: record.termsHash, storageBytes: '586', depositYocto: '5860000000000000000000', gas: '30000000000000' };
    f.state.views = { get_config: deployed, get_request: record, quote_create_request: quote };
    const common = { config: deployed, contractId, signerAccountId: f.identity.accountId };
    const call = method === 'create_request' ? prepareCreateRequest({ ...common, terms: record.terms, quote })
      : method === 'pay_instant_native' ? preparePayInstantNative({ ...common, request: record, observedAtNs: (BigInt(f.state.now) * 1000000n).toString() })
      : method === 'cancel_unfunded' ? prepareCancelUnfunded({ ...common, request: record })
      : prepareRetryNativeTransfer({ ...common, request: record });
    const backend = createReviewedWalletBackend({ config: f.config, vault: f.vault, storage: f.storage, policy: f.policy, chain: f.chain,
      reader: buildClient(f.config, f.fetcher, false, () => new Date(f.state.now)), fetcher: f.fetcher, crypto: f.guardedCrypto, now: () => f.state.now });
    await assert.rejects(backend.prepareContractCall({ ...call, depositYocto: (BigInt(call.depositYocto) + 1n).toString() }));
    const review = await backend.prepareContractCall(call);
    const result = await backend.submit(review.id, async () => true);
    assert.equal(result.kind, 'final'); assert.equal(result.settlementProof, 'NOT_VERIFIED'); assert.equal(f.state.sends, 1);
    assert.equal(f.state.tx.transaction.actions[0].functionCall.methodName, method);
    assert.equal(f.state.tx.transaction.actions[0].functionCall.deposit.toString(), call.depositYocto);
    f.vault.lock();
  });
}
