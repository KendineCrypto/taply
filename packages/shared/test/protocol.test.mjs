import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CHAIN_STATES, ChainStateSchema, LocalWalletStateSchema, SessionStateSchema,
  ContractRequestSchema, OperationRecordSchema, PaymentIntentResponseSchema, VerifiedReceiptSchema,
  SessionEventSchema, HandshakeSessionSchema, MerchantProfileSchema, ApiErrorSchema,
  ContractMethodArgs, FundProtectedNativeArgsSchema, NativeTransferCallbackArgsSchema,
  TransactionHintSchema, createCursorPageSchema, PHASE_0_CONFIG, DYNAMIC_RESPONSE_HEADERS,
  calculateTermsHash, calculateSessionCommitment, parseIntentTermsJson,
} from "../dist/index.js";

// All data here is synthetic. Passing a schema proves shape, never chain truth.
const terms = parseIntentTermsJson(readFileSync(new URL("../test-vectors/intent-a.json", import.meta.url)));
const expected = JSON.parse(readFileSync(new URL("../test-vectors/expected.json", import.meta.url)));
const at = expected.time.fundedAtNs;
const cutoff = expected.time.cancelUntilNs;
const chainHash = (character) => character.repeat(32);
const block = (time = at, height = "100") => ({ hash: chainHash("1"), height, timestampNs: time });
function request(status = "LOCKED", changes = {}) {
  const input = {
    terms: structuredClone(terms), termsHash: expected.a.termsHash, sessionCommitment: expected.a.sessionCommitment,
    recipientAccountId: "alice.testnet", status, revision: "2", createdAtNs: (BigInt(at) - 1n).toString(),
    payerAccountId: "bob.testnet", fundedAtNs: at, cancelUntilNs: cutoff, settlementBranch: null, latestOperation: null,
    ...changes,
  };
  if (status === "OPEN" || status === "CANCELLED_UNFUNDED") {
    input.payerAccountId = null; input.fundedAtNs = null; input.cancelUntilNs = null;
  }
  if (status.startsWith("PAYOUT_")) {
    input.terms.mode = "instant"; input.terms.cancelDurationNs = null; input.cancelUntilNs = null;
    input.termsHash = calculateTermsHash(input.terms); input.sessionCommitment = calculateSessionCommitment(input.terms);
  }
  if (!["OPEN", "CANCELLED_UNFUNDED", "LOCKED"].includes(status)) {
    const refund = status.startsWith("REFUND_") || status === "CANCELLED_REFUNDED";
    input.settlementBranch = refund ? "PAYER" : "RECIPIENT";
    const operationStatus = status.endsWith("_IN_FLIGHT") ? "IN_FLIGHT" : status.endsWith("_FAILED_RECOVERABLE") ? "FAILED" : "SUCCEEDED";
    input.latestOperation = {
      nonce: "1", kind: refund ? "PROTECTED_REFUND" : input.terms.mode === "instant" ? "INSTANT_PAYOUT" : "PROTECTED_RELEASE",
      destinationAccountId: refund ? "bob.testnet" : "alice.testnet", amountBaseUnits: terms.amountBaseUnits,
      status: operationStatus, startedAtNs: refund || input.terms.mode === "instant" ? at : cutoff,
      resolvedAtNs: operationStatus === "IN_FLIGHT" ? null : cutoff,
      failureCode: operationStatus === "FAILED" ? "NATIVE_TRANSFER_FAILED" : null,
    };
  }
  return input;
}
function response(value = request()) {
  return {
    observation: { data: value, source: "rpc", assurance: "verified_final",
      observedBlock: block(value.latestOperation?.resolvedAtNs ?? value.latestOperation?.startedAtNs ?? at),
      checkedAt: "2026-11-01T00:00:00Z", stale: false, rpcAvailable: true },
    fundingEligibility: "NOT_OPEN", incident: null,
    derived: { callerRole: "payer", cancelWindowOpen: true, releaseEligible: false,
      retry: { eligible: false, operationNonce: null, kind: null } },
  };
}

for (const state of CHAIN_STATES) {
  test(`stored state ${state} has a consistent fixture`, () => assert.equal(ContractRequestSchema.safeParse(request(state)).success, true));
}

for (const state of ["EXPIRED", "FUNDING", "DISCONNECTED", "DRAFT", "AWAITING_SIGNATURE", "USER_REJECTED", "OUTCOME_UNKNOWN", "PAID"]) {
  test(`non-chain state ${state} cannot become contract status`, () => assert.equal(ChainStateSchema.safeParse(state).success, false));
}

test("wallet, session, and chain enums remain separate", () => {
  assert.equal(LocalWalletStateSchema.safeParse("OUTCOME_UNKNOWN").success, true);
  assert.equal(SessionStateSchema.safeParse("EXPIRED").success, true);
  assert.equal(SessionStateSchema.safeParse("DISCONNECTED").success, false);
  assert.equal(SessionStateSchema.safeParse("FINAL_PAID").success, false);
});

test("funding-derived cutoff is mandatory; pre-funding cutoff is null", () => {
  assert.equal(ContractRequestSchema.safeParse({ ...request("OPEN"), cancelUntilNs: cutoff }).success, false);
  assert.equal(ContractRequestSchema.safeParse({ ...request(), cancelUntilNs: (BigInt(cutoff) + 1n).toString() }).success, false);
  assert.equal(ContractRequestSchema.safeParse({ ...request(), fundedAtNs: null }).success, false);
  assert.equal(ContractRequestSchema.safeParse({ ...request(), payerAccountId: null }).success, false);
});

test("expired or premature funding and overlong request lifetime reject", () => {
  for (const fundedAtNs of [terms.fundingExpiresAtNs, (BigInt(at) - 2n).toString()]) {
    assert.equal(ContractRequestSchema.safeParse({ ...request(), fundedAtNs }).success, false);
  }
  assert.equal(ContractRequestSchema.safeParse({ ...request(), createdAtNs: "0" }).success, false);
});

test("invalid decimal nested inputs return validation errors instead of throwing", () => {
  for (const changes of [{ createdAtNs: "bad" }, { fundedAtNs: "bad" }, { cancelUntilNs: "bad" },
    { terms: { ...terms, cancelDurationNs: "bad" } }]) {
    assert.equal(ContractRequestSchema.safeParse({ ...request(), ...changes }).success, false);
  }
});

test("recipient, hashes, principal, and operation branch are bound", () => {
  for (const changes of [{ recipientAccountId: "mallory.testnet" }, { termsHash: "0".repeat(64) }, { sessionCommitment: null }])
    assert.equal(ContractRequestSchema.safeParse({ ...request(), ...changes }).success, false);
  const value = request("RELEASE_IN_FLIGHT");
  for (const changes of [{ destinationAccountId: "mallory.testnet" }, { amountBaseUnits: "1" }, { kind: "PROTECTED_REFUND" }, { status: "SUCCEEDED" }])
    assert.equal(ContractRequestSchema.safeParse({ ...value, latestOperation: { ...value.latestOperation, ...changes } }).success, false);
});

test("refund initiation loses exactly at cutoff, but refund retry can occur later", () => {
  const value = request("REFUND_IN_FLIGHT");
  value.latestOperation.startedAtNs = (BigInt(cutoff) - 1n).toString();
  assert.equal(ContractRequestSchema.safeParse(value).success, true);
  value.latestOperation.startedAtNs = cutoff;
  assert.equal(ContractRequestSchema.safeParse(value).success, false);
  value.latestOperation.nonce = "2";
  assert.equal(ContractRequestSchema.safeParse(value).success, true);
});

test("release at cutoff is eligible, before cutoff is not", () => {
  const value = request("RELEASE_IN_FLIGHT");
  assert.equal(ContractRequestSchema.safeParse(value).success, true);
  value.latestOperation.startedAtNs = (BigInt(cutoff) - 1n).toString();
  assert.equal(ContractRequestSchema.safeParse(value).success, false);
});

test("operation resolution cannot hide failed transfer or precede initiation", () => {
  const operation = request("REFUND_FAILED_RECOVERABLE").latestOperation;
  assert.equal(OperationRecordSchema.safeParse({ ...operation, failureCode: null }).success, false);
  assert.equal(OperationRecordSchema.safeParse({ ...operation, resolvedAtNs: "0" }).success, false);
});

test("payer-only retry projection needs a recorded refund failure and current nonce", () => {
  const value = response(request("REFUND_FAILED_RECOVERABLE"));
  value.derived.cancelWindowOpen = false;
  value.derived.retry = { eligible: true, operationNonce: "1", kind: "PROTECTED_REFUND" };
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, true);
  value.derived.callerRole = "recipient";
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
  value.derived.callerRole = "payer";
  value.derived.retry.operationNonce = "2";
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
});

test("recipient-only payout retry cannot be granted to payer", () => {
  const value = response(request("PAYOUT_FAILED_RECOVERABLE"));
  value.derived.cancelWindowOpen = false;
  value.derived.retry = { eligible: true, operationNonce: "1", kind: "INSTANT_PAYOUT" };
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
  value.derived.callerRole = "recipient";
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, true);
});

test("callback failure never enables a retry from an in-flight operation", () => {
  const value = response(request("PAYOUT_IN_FLIGHT"));
  value.incident = "CALLBACK_FAILED";
  value.derived.cancelWindowOpen = false;
  value.derived.retry = { eligible: false, operationNonce: "1", kind: "INSTANT_PAYOUT" };
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, true);
  value.derived.retry.eligible = true;
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
});

test("mock data cannot claim verification, block provenance, or active financial actions", () => {
  const value = response();
  value.observation.source = "mock";
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
  value.observation.assurance = "unverified"; value.observation.observedBlock = null;
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
  value.derived.cancelWindowOpen = null; value.derived.releaseEligible = null;
  value.fundingEligibility = "UNKNOWN";
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, true);
});

test("historical verified state survives RPC outage with freshness independent", () => {
  const value = response(request("FINAL_PAID"));
  value.derived.cancelWindowOpen = false;
  value.observation.rpcAvailable = false;
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
  value.observation.stale = true;
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, true);
  assert.equal(value.observation.assurance, "verified_final");
});

test("unknown and mismatch observations support null data without fabricating OPEN", () => {
  const value = response();
  value.observation.data = null; value.observation.observedBlock = null; value.observation.assurance = "unknown";
  value.fundingEligibility = "UNKNOWN"; value.incident = "OUTCOME_UNKNOWN";
  value.derived.cancelWindowOpen = null; value.derived.releaseEligible = null;
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, true);
  value.observation.assurance = "mismatch";
  value.observation.diagnostic = { differences: [{ field: "recipientAccountId", expected: "alice.testnet", observed: "mallory.testnet" }] };
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, true);
});

test("observation block cannot precede recorded operation resolution", () => {
  const value = response(request("FINAL_PAID"));
  value.derived.cancelWindowOpen = false;
  value.observation.observedBlock = block(at);
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
});

test("funding-derived cutoff rejects u64 overflow", () => {
  const max = 18446744073709551615n;
  const value = request();
  value.terms.fundingExpiresAtNs = max.toString();
  value.termsHash = calculateTermsHash(value.terms);
  value.sessionCommitment = calculateSessionCommitment(value.terms);
  value.createdAtNs = (max - 2n).toString();
  value.fundedAtNs = (max - 1n).toString();
  value.cancelUntilNs = max.toString();
  assert.equal(ContractRequestSchema.safeParse(value).success, false);
});

test("derived deadline and funding eligibility use observed chain time", () => {
  const value = response();
  value.observation.observedBlock = block(cutoff);
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, false);
  value.derived.cancelWindowOpen = false; value.derived.releaseEligible = true;
  assert.equal(PaymentIntentResponseSchema.safeParse(value).success, true);
  const open = response(request("OPEN"));
  open.derived.cancelWindowOpen = false; open.fundingEligibility = "ELIGIBLE";
  open.observation.observedBlock = block(terms.fundingExpiresAtNs);
  assert.equal(PaymentIntentResponseSchema.safeParse(open).success, false);
});

function receipt(refund = false) {
  const beneficiary = refund ? "bob.testnet" : "alice.testnet";
  return {
    schemaVersion: "taply.receipt.v1", requestId: terms.id, termsHash: expected.a.termsHash,
    sessionId: terms.sessionBinding.id, network: "near-testnet", contractId: terms.contractId,
    contractCodeHash: chainHash("2"), mode: "protected", finalStatus: refund ? "CANCELLED_REFUNDED" : "FINAL_PAID",
    payerAccountId: "bob.testnet", recipientAccountId: "alice.testnet", settlementBeneficiaryAccountId: beneficiary,
    assetId: "near:native", amountBaseUnits: terms.amountBaseUnits, operationNonce: "1",
    fundingTransaction: { hash: chainHash("3"), signerAccountId: "bob.testnet" },
    settlementTransaction: { hash: chainHash("4"), signerAccountId: "bob.testnet" },
    fundingReceipt: { receiptId: chainHash("5"), executorAccountId: terms.contractId, block: block(), outcome: "SUCCESS" },
    transferReceipt: { receiptId: chainHash("6"), executorAccountId: beneficiary, block: block(cutoff, "101"), outcome: "SUCCESS" },
    callbackReceipt: { receiptId: chainHash("7"), executorAccountId: terms.contractId, block: block(cutoff, "102"), outcome: "SUCCESS" },
    contractStateBlock: block(cutoff, "103"),
    verification: { state: "verified_final", executionFinality: "FINAL", trustModel: "configured-rpc", rpcProviderId: "fixture-only", checkedAt: "2026-11-01T00:01:00Z" },
  };
}

test("paid/refunded receipts require distinct successful internal receipt evidence", () => {
  assert.equal(VerifiedReceiptSchema.safeParse(receipt()).success, true);
  assert.equal(VerifiedReceiptSchema.safeParse(receipt(true)).success, true);
  for (const field of ["fundingReceipt", "transferReceipt", "callbackReceipt"]) {
    const value = receipt(); value[field].outcome = "FAILURE";
    assert.equal(VerifiedReceiptSchema.safeParse(value).success, false);
    delete value[field];
    assert.equal(VerifiedReceiptSchema.safeParse(value).success, false);
  }
});

test("deposit-only, forged executor, wrong beneficiary, and nonfinal claims reject", () => {
  for (const state of ["LOCKED", "PAYOUT_IN_FLIGHT", "REFUND_FAILED_RECOVERABLE"]) {
    assert.equal(VerifiedReceiptSchema.safeParse({ ...receipt(), finalStatus: state }).success, false);
  }
  const wrong = receipt(true); wrong.settlementBeneficiaryAccountId = "alice.testnet";
  assert.equal(VerifiedReceiptSchema.safeParse(wrong).success, false);
  const forged = receipt(); forged.callbackReceipt.executorAccountId = "evil.testnet";
  assert.equal(VerifiedReceiptSchema.safeParse(forged).success, false);
  const optimistic = receipt(); optimistic.verification.executionFinality = "EXECUTED_OPTIMISTIC";
  assert.equal(VerifiedReceiptSchema.safeParse(optimistic).success, false);
  const duplicate = receipt(); duplicate.callbackReceipt.receiptId = duplicate.transferReceipt.receiptId;
  assert.equal(VerifiedReceiptSchema.safeParse(duplicate).success, false);
});

test("same top-level transaction may contain funding, payout, callback receipts", () => {
  const value = receipt(); value.mode = "instant";
  value.settlementTransaction = structuredClone(value.fundingTransaction);
  assert.equal(VerifiedReceiptSchema.safeParse(value).success, true);
  value.finalStatus = "CANCELLED_REFUNDED";
  assert.equal(VerifiedReceiptSchema.safeParse(value).success, false);
});

test("SSE hints cannot inject paid/verified fields or secret tokens", () => {
  const hint = { schemaVersion: "taply.events.v1", eventId: "1", sessionId: terms.sessionBinding.id,
    type: "payment.changed", emittedAt: "2026-11-01T00:00:00Z", intentId: terms.id, intentRevisionHint: "2" };
  assert.equal(SessionEventSchema.safeParse(hint).success, true);
  for (const extra of [{ paid: true }, { verified: true }, { token: "secret" }, { status: "FINAL_PAID" }])
    assert.equal(SessionEventSchema.safeParse({ ...hint, ...extra }).success, false);
  assert.equal(SessionEventSchema.safeParse({ ...hint, type: "payment.paid" }).success, false);
});

test("session review and Protected funding acknowledge terms without payment flags", () => {
  const args = { id: terms.id, expectedTermsHash: expected.a.termsHash, acceptedCancelDurationNs: "60000000000", consentVersion: "taply.protected-consent.v1" };
  assert.equal(FundProtectedNativeArgsSchema.safeParse(args).success, true);
  const { consentVersion, ...missing } = args;
  assert.equal(typeof consentVersion, "string");
  assert.equal(FundProtectedNativeArgsSchema.safeParse(missing).success, false);
  assert.equal(FundProtectedNativeArgsSchema.safeParse({ ...args, acceptedCancelDurationNs: "1" }).success, false);
  assert.equal(NativeTransferCallbackArgsSchema.safeParse({ id: terms.id, operationNonce: "1", kind: "PROTECTED_RELEASE", success: true }).success, false);
  assert.equal("mark_paid" in ContractMethodArgs, false);
});

test("sessions distinguish presence from authenticated participant binding", () => {
  const value = { ...terms.sessionBinding, state: "OPEN", merchantAccountId: "alice.testnet", payerAccountId: null,
    intentId: terms.id, termsHash: expected.a.termsHash, comparisonCode: "XMBVTN", presence: { merchant: true, payer: false } };
  assert.equal(HandshakeSessionSchema.safeParse(value).success, true);
  assert.equal(HandshakeSessionSchema.safeParse({ ...value, state: "PAIRED" }).success, false);
  assert.equal(HandshakeSessionSchema.safeParse({ ...value, state: "PAIRED", payerAccountId: "bob.testnet" }).success, true);
});

test("merchant slug substitution and signature-shape errors reject", () => {
  const profile = { merchantId: "near-testnet:alice.testnet", slug: "alice.testnet", accountId: "alice.testnet", displayName: "Fixture only",
    profileVersion: "1", issuedAtNs: at, expiresAtNs: cutoff,
    binding: { standard: "NEP-413", message: "Not a real signature", nonceBase64: Buffer.alloc(32).toString("base64"),
      recipient: "https://fixture.invalid", publicKey: `ed25519:${chainHash("1")}`, signatureBase64: Buffer.alloc(64).toString("base64") } };
  // Syntactic acceptance is intentionally NOT account-control verification.
  assert.equal(MerchantProfileSchema.safeParse(profile).success, true);
  assert.equal(MerchantProfileSchema.safeParse({ ...profile, accountId: "mallory.testnet" }).success, false);
  assert.equal(MerchantProfileSchema.safeParse({ ...profile, binding: { ...profile.binding, nonceBase64: "bad" } }).success, false);
});

test("unknown result errors force reconciliation and stable translation keys", () => {
  const error = { schemaVersion: "taply.api.v1", error: { code: "RPC_TIMEOUT_UNKNOWN_STATUS", messageKey: "errors.RPC_TIMEOUT_UNKNOWN_STATUS",
    requestId: "fixture", retryAction: "WAIT_AND_RECONCILE", retryAfterMs: null, details: {} } };
  assert.equal(ApiErrorSchema.safeParse(error).success, true);
  assert.equal(ApiErrorSchema.safeParse({ ...error, error: { ...error.error, retryAction: "RETRY_SAME_OPERATION" } }).success, false);
  assert.equal(ApiErrorSchema.safeParse({ ...error, error: { ...error.error, messageKey: "errors.PAID" } }).success, false);
});

test("transaction hints/pagination do not establish chain truth", () => {
  const hint = { txHash: chainHash("1"), signerAccountId: "bob.testnet", purpose: "FUND" };
  assert.equal(TransactionHintSchema.safeParse(hint).success, true);
  assert.equal(TransactionHintSchema.safeParse({ ...hint, verified: true }).success, false);
  const page = createCursorPageSchema(TransactionHintSchema);
  assert.equal(page.safeParse({ items: [hint], nextCursor: null }).success, true);
  assert.equal(page.safeParse({ items: Array(101).fill(hint), nextCursor: null }).success, false);
});

test("Phase 0 enables no financial capability and invents no deployment or budget", () => {
  assert.equal(Object.values(PHASE_0_CONFIG.capabilities).every((enabled) => enabled === false), true);
  assert.equal(PHASE_0_CONFIG.network, "near-testnet");
  assert.equal(PHASE_0_CONFIG.deployment, null);
  assert.equal(PHASE_0_CONFIG.gas, null);
  assert.equal(PHASE_0_CONFIG.storage, null);
  assert.equal(DYNAMIC_RESPONSE_HEADERS["Cache-Control"], "no-store");
});
