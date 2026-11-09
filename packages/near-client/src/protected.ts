import { z } from "zod";
import {
  AccountIdSchema, ContractMethodArgs, ContractRequestSchema, IntentTermsSchema, MAX_CANCEL_DURATION_NS,
  MIN_CANCEL_DURATION_NS, PositiveU64Schema, U128Schema, U64Schema, calculateTermsHash,
  type ContractRequest, type IntentTerms,
} from "@taply/shared";
import { CreateQuoteSchema, type CreateQuote } from "./contract.js";
import { NearClientError } from "./rpc.js";

/**
 * Protected Pay (G3) CANDIDATE contract seam: contracts/payments-protected.
 *
 * UNREVIEWED. Nothing here is wired to a default deployment. The pilot G1
 * contract is refused outright: it cannot hold escrow. Every builder repeats
 * the contract's own guards so a wallet is never asked to sign a call the
 * contract would reject, but the contract re-checks everything at execution
 * time and chain time decides cancel vs release, not these builders.
 */
export const PROTECTED_CONTRACT_VERSION = "0.5.0-g3-candidate";
export const PROTECTED_CONSENT_VERSION = "taply.protected-consent.v1";
const PILOT_CONTRACT_ID = "taply-pay-pilot-1.testnet";

export const ProtectedContractConfigSchema = z.strictObject({
  schemaVersion: z.literal("taply.contract-config.v1"),
  contractVersion: z.literal(PROTECTED_CONTRACT_VERSION),
  network: z.literal("near-testnet"),
  contractId: AccountIdSchema,
  intentVersion: z.literal("taply.intent.v1"),
  eventVersion: z.literal("0.4.0"),
  capabilities: z.strictObject({
    instantNative: z.boolean(), protectedPay: z.boolean(), handshake: z.boolean(),
    merchantProfiles: z.boolean(), nep141: z.boolean(), sponsoredGas: z.boolean(),
  }),
  quoteVersion: PositiveU64Schema,
  storageByteCostYocto: U128Schema,
  gas: z.strictObject({
    createRequest: PositiveU64Schema, payInstantNative: PositiveU64Schema,
    retryNativeTransfer: PositiveU64Schema, cancelUnfunded: PositiveU64Schema, callback: PositiveU64Schema,
    fundProtectedNative: PositiveU64Schema, cancelProtected: PositiveU64Schema, releaseProtected: PositiveU64Schema,
  }),
  protected: z.strictObject({
    consentVersion: z.literal(PROTECTED_CONSENT_VERSION),
    minCancelDurationNs: z.literal(MIN_CANCEL_DURATION_NS.toString()),
    maxCancelDurationNs: z.literal(MAX_CANCEL_DURATION_NS.toString()),
    cutoffRule: z.literal("CANCEL_IF_BLOCK_TIME_LT_CUTOFF_RELEASE_IF_GTE"),
    reviewStatus: z.enum(["UNREVIEWED_NOT_FOR_REAL_FUNDS"]),
  }),
  storageRefundPolicy: z.literal("PERMANENT_RECORD_NO_WITHDRAWAL"),
  unknownCallbackPolicy: z.literal("IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE"),
  testFaultBuild: z.boolean(),
});
export type ProtectedContractConfig = z.infer<typeof ProtectedContractConfigSchema>;

/** Minimum gas the candidate enforces (contracts/payments-protected/src/lib.rs). */
export const PROTECTED_MINIMUM_GAS = Object.freeze({
  createRequest: 30_000_000_000_000n,
  fundProtectedNative: 20_000_000_000_000n,
  cancelProtected: 50_000_000_000_000n,
  releaseProtected: 50_000_000_000_000n,
  retryNativeTransfer: 50_000_000_000_000n,
});

export type ProtectedConfigProblem =
  | "PILOT_CANNOT_HOLD_ESCROW" | "CONTRACT_ID_MISMATCH" | "TEST_FAULT_BUILD" | "PROTECTED_DISABLED"
  | "UNSUPPORTED_CAPABILITY" | "UNSUPPORTED_QUOTE_VERSION" | "GAS_BELOW_MINIMUM" | "UNREVIEWED_CANDIDATE";

/**
 * Everything that must hold before a frontend may offer Protected Pay. While the
 * candidate is unreviewed the list ALWAYS contains UNREVIEWED_CANDIDATE; only a
 * protected QA build may choose to accept that single problem, and never for
 * real funds.
 */
export function protectedConfigProblems(config: ProtectedContractConfig, expectedContractId: string): ProtectedConfigProblem[] {
  const problems: ProtectedConfigProblem[] = [];
  if (expectedContractId === PILOT_CONTRACT_ID || config.contractId === PILOT_CONTRACT_ID) problems.push("PILOT_CANNOT_HOLD_ESCROW");
  if (config.contractId !== expectedContractId) problems.push("CONTRACT_ID_MISMATCH");
  if (config.testFaultBuild) problems.push("TEST_FAULT_BUILD");
  if (!config.capabilities.protectedPay) problems.push("PROTECTED_DISABLED");
  const { handshake, merchantProfiles, nep141, sponsoredGas } = config.capabilities;
  if (handshake || merchantProfiles || nep141 || sponsoredGas) problems.push("UNSUPPORTED_CAPABILITY");
  if (config.quoteVersion !== "1") problems.push("UNSUPPORTED_QUOTE_VERSION");
  const { gas } = config;
  if (BigInt(gas.createRequest) < PROTECTED_MINIMUM_GAS.createRequest
    || BigInt(gas.fundProtectedNative) < PROTECTED_MINIMUM_GAS.fundProtectedNative
    || BigInt(gas.cancelProtected) < PROTECTED_MINIMUM_GAS.cancelProtected
    || BigInt(gas.releaseProtected) < PROTECTED_MINIMUM_GAS.releaseProtected
    || BigInt(gas.retryNativeTransfer) < PROTECTED_MINIMUM_GAS.retryNativeTransfer) problems.push("GAS_BELOW_MINIMUM");
  if (config.protected.reviewStatus === "UNREVIEWED_NOT_FOR_REAL_FUNDS") problems.push("UNREVIEWED_CANDIDATE");
  return problems;
}

export interface PreparedProtectedCall {
  receiverId: string;
  methodName: "create_request" | "fund_protected_native" | "cancel_protected" | "release_protected" | "retry_native_transfer";
  args: Record<string, unknown>;
  gas: string;
  depositYocto: string;
}

function refuse(): never {
  throw new NearClientError("INVALID_ARGUMENT", false);
}

function protectedTerms(contractId: string, terms: IntentTerms): IntentTerms {
  if (contractId === PILOT_CONTRACT_ID) refuse();
  const parsed = IntentTermsSchema.safeParse(terms);
  if (!parsed.success) refuse();
  const value = parsed.data;
  // Candidate: native Protected only, no merchant/session binding.
  if (value.contractId !== contractId || value.mode !== "protected" || value.cancelDurationNs === null
    || value.assetId !== "near:native" || value.merchantAccountId !== null || value.sessionBinding !== null) refuse();
  return value;
}

function request(contractId: string, input: ContractRequest): ContractRequest {
  const parsed = ContractRequestSchema.safeParse(input);
  if (!parsed.success) refuse();
  protectedTerms(contractId, parsed.data.terms);
  return parsed.data;
}

function observed(ns: string): bigint {
  if (!U64Schema.safeParse(ns).success) refuse();
  return BigInt(ns);
}

function checkedArgs<K extends keyof typeof ContractMethodArgs>(method: K, args: unknown): Record<string, unknown> {
  const parsed = ContractMethodArgs[method].safeParse(args);
  if (!parsed.success) refuse();
  return parsed.data as Record<string, unknown>;
}

/** Recipient signs the immutable Protected terms, including the cancel duration. */
export function prepareCreateProtectedRequest(input: {
  contractId: string; config: ProtectedContractConfig; terms: IntentTerms; quote: CreateQuote; signerAccountId: string;
}): PreparedProtectedCall {
  const terms = protectedTerms(input.contractId, input.terms);
  const quote = CreateQuoteSchema.safeParse(input.quote);
  if (!quote.success) refuse();
  const { requestId, termsHash, quoteVersion, depositYocto, gas } = quote.data;
  if (input.signerAccountId !== terms.creatorAccountId) refuse();
  if (requestId !== terms.id || termsHash !== calculateTermsHash(terms) || quoteVersion !== input.config.quoteVersion) refuse();
  if (BigInt(gas) < BigInt(input.config.gas.createRequest)) refuse();
  return { receiverId: input.contractId, methodName: "create_request", gas, depositYocto,
    args: checkedArgs("create_request", { terms, quoteVersion }) };
}

/**
 * Payer consent + exact principal. `acceptedCancelDurationNs` is what the
 * consent screen SHOWED; it must equal the signed terms or nothing is built.
 */
export function prepareFundProtectedNative(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; signerAccountId: string;
  observedAtNs: string; acceptedCancelDurationNs: string;
}): PreparedProtectedCall {
  const r = request(input.contractId, input.request);
  const terms = r.terms;
  if (r.status !== "OPEN" || observed(input.observedAtNs) >= BigInt(terms.fundingExpiresAtNs)) refuse();
  if (terms.permittedPayerAccountId !== null && terms.permittedPayerAccountId !== input.signerAccountId) refuse();
  if (input.acceptedCancelDurationNs !== terms.cancelDurationNs) refuse();
  return { receiverId: input.contractId, methodName: "fund_protected_native", gas: input.config.gas.fundProtectedNative,
    depositYocto: terms.amountBaseUnits,
    args: checkedArgs("fund_protected_native", { id: terms.id, expectedTermsHash: r.termsHash,
      acceptedCancelDurationNs: terms.cancelDurationNs, consentVersion: PROTECTED_CONSENT_VERSION }) };
}

/**
 * Payer-only refund request while the observed final block is before the
 * cutoff. Inclusion before the cutoff is NOT guaranteed by building this.
 */
export function prepareCancelProtected(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; signerAccountId: string; observedAtNs: string;
}): PreparedProtectedCall {
  const r = request(input.contractId, input.request);
  if (r.status !== "LOCKED" || r.cancelUntilNs === null || r.payerAccountId !== input.signerAccountId) refuse();
  if (observed(input.observedAtNs) >= BigInt(r.cancelUntilNs)) refuse();
  return { receiverId: input.contractId, methodName: "cancel_protected", gas: input.config.gas.cancelProtected,
    depositYocto: "1", args: checkedArgs("cancel_protected", { id: r.terms.id, expectedTermsHash: r.termsHash }) };
}

/** Anyone may release once a final block at/after the cutoff has been observed. */
export function prepareReleaseProtected(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; observedAtNs: string;
}): PreparedProtectedCall {
  const r = request(input.contractId, input.request);
  if (r.status !== "LOCKED" || r.cancelUntilNs === null) refuse();
  if (observed(input.observedAtNs) < BigInt(r.cancelUntilNs)) refuse();
  return { receiverId: input.contractId, methodName: "release_protected", gas: input.config.gas.releaseProtected,
    depositYocto: "1", args: checkedArgs("release_protected", { id: r.terms.id }) };
}

/** Beneficiary-only retry of a RECORDED refund/release failure: same branch, same nonce. */
export function prepareRetryProtectedTransfer(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; signerAccountId: string;
}): PreparedProtectedCall {
  const r = request(input.contractId, input.request);
  const op = r.latestOperation;
  if (op === null || op.status !== "FAILED") refuse();
  const refund = r.status === "REFUND_FAILED_RECOVERABLE" && op.kind === "PROTECTED_REFUND";
  const release = r.status === "RELEASE_FAILED_RECOVERABLE" && op.kind === "PROTECTED_RELEASE";
  if (!refund && !release) refuse();
  const beneficiary = refund ? r.payerAccountId : r.recipientAccountId;
  if (input.signerAccountId !== beneficiary || op.destinationAccountId !== beneficiary) refuse();
  return { receiverId: input.contractId, methodName: "retry_native_transfer", gas: input.config.gas.retryNativeTransfer,
    depositYocto: "1", args: checkedArgs("retry_native_transfer", { id: r.terms.id, expectedOperationNonce: op.nonce }) };
}
