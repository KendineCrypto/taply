import { z } from "zod";
import {
  AccountIdSchema, AmountSchema, ContractMethodArgs, ContractRequestSchema, HashHexSchema,
  IntentTermsSchema, PositiveU64Schema, U128Schema, U64Schema, calculateTermsHash,
  type ContractRequest, type IntentTerms,
} from "@taply/shared";
import { NearClientError } from "./rpc.js";
export { CONTRACT_ERROR_CODES, extractContractErrorCode, type ContractErrorCode } from "./contract-errors.js";

/**
 * Taply payments contract v0.4.0 read objects (contracts/payments/ABI.md).
 *
 * These schemas describe what the contract returns. Parsing one proves its shape,
 * not that the code is approved, the state is final or a payout really happened:
 * the client only returns them from reads anchored to a finalized block where the
 * contract's code hash matched the configured, approved hash.
 */
export const ContractConfigSchema = z.strictObject({
  schemaVersion: z.literal("taply.contract-config.v1"),
  contractVersion: z.literal("0.4.0"),
  network: z.literal("near-testnet"),
  contractId: AccountIdSchema,
  intentVersion: z.literal("taply.intent.v1"),
  eventVersion: z.literal("0.4.0"),
  // Booleans, not literals: an unexpected capability is reported by
  // contractConfigProblems() instead of looking like a malformed response.
  capabilities: z.strictObject({
    instantNative: z.boolean(), protectedPay: z.boolean(), handshake: z.boolean(),
    merchantProfiles: z.boolean(), nep141: z.boolean(), sponsoredGas: z.boolean(),
  }),
  quoteVersion: PositiveU64Schema,
  storageByteCostYocto: U128Schema,
  gas: z.strictObject({
    createRequest: PositiveU64Schema, payInstantNative: PositiveU64Schema,
    retryNativeTransfer: PositiveU64Schema, cancelUnfunded: PositiveU64Schema, callback: PositiveU64Schema,
  }),
  storageRefundPolicy: z.literal("PERMANENT_RECORD_NO_WITHDRAWAL"),
  unknownCallbackPolicy: z.literal("IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE"),
  testFaultBuild: z.boolean(),
});
export type ContractConfig = z.infer<typeof ContractConfigSchema>;

export const CreateQuoteSchema = z.strictObject({
  quoteVersion: PositiveU64Schema,
  requestId: HashHexSchema,
  termsHash: HashHexSchema,
  storageBytes: PositiveU64Schema,
  depositYocto: AmountSchema,
  gas: PositiveU64Schema,
});
export type CreateQuote = z.infer<typeof CreateQuoteSchema>;

/** `get_receipt`: contract terminal facts. NOT a VerifiedReceipt and NOT finality proof. */
export const TerminalFactsSchema = z.strictObject({
  schemaVersion: z.literal("taply.terminal-facts.v1"),
  request: ContractRequestSchema,
  terminalBlockHeight: U64Schema,
  terminalAtNs: U64Schema,
  payoutConfirmed: z.boolean(),
  evidenceKind: z.literal("CONTRACT_FACTS_NOT_FINALITY_PROOF"),
}).superRefine((facts, ctx) => {
  const status = facts.request?.status;
  if (status !== "FINAL_PAID" && status !== "CANCELLED_UNFUNDED")
    ctx.addIssue({ code: "custom", message: "Terminal facts exist only for FINAL_PAID or CANCELLED_UNFUNDED" });
  if (facts.payoutConfirmed !== (status === "FINAL_PAID"))
    ctx.addIssue({ code: "custom", message: "payoutConfirmed must match the terminal status" });
});
export type TerminalFacts = z.infer<typeof TerminalFactsSchema>;

export interface PaymentRequestRead { id: string; request: ContractRequest | null }
export interface TerminalFactsRead { id: string; facts: TerminalFacts | null }

/** Minimum gas per method from abi.json; the contract enforces the same floors. */
export const ABI_MINIMUM_GAS = Object.freeze({
  createRequest: 30_000_000_000_000n,
  payInstantNative: 50_000_000_000_000n,
  retryNativeTransfer: 50_000_000_000_000n,
  cancelUnfunded: 15_000_000_000_000n,
});

export type ContractConfigProblem =
  | "CONTRACT_ID_MISMATCH" | "TEST_FAULT_BUILD" | "INSTANT_NATIVE_DISABLED"
  | "UNREVIEWED_CAPABILITY" | "UNSUPPORTED_QUOTE_VERSION" | "GAS_BELOW_ABI_MINIMUM";

/**
 * Everything that must hold before a frontend may offer Instant Pay against this
 * contract. An empty list is necessary, not sufficient: deployment approval and
 * the code-hash pin come from human review, not from the contract's own answer.
 */
export function contractConfigProblems(config: ContractConfig, expectedContractId: string): ContractConfigProblem[] {
  const problems: ContractConfigProblem[] = [];
  if (config.contractId !== expectedContractId) problems.push("CONTRACT_ID_MISMATCH");
  if (config.testFaultBuild) problems.push("TEST_FAULT_BUILD");
  if (!config.capabilities.instantNative) problems.push("INSTANT_NATIVE_DISABLED");
  const { protectedPay, handshake, merchantProfiles, nep141, sponsoredGas } = config.capabilities;
  if (protectedPay || handshake || merchantProfiles || nep141 || sponsoredGas) problems.push("UNREVIEWED_CAPABILITY");
  if (config.quoteVersion !== "1") problems.push("UNSUPPORTED_QUOTE_VERSION");
  const { gas } = config;
  if (BigInt(gas.createRequest) < ABI_MINIMUM_GAS.createRequest
    || BigInt(gas.payInstantNative) < ABI_MINIMUM_GAS.payInstantNative
    || BigInt(gas.retryNativeTransfer) < ABI_MINIMUM_GAS.retryNativeTransfer
    || BigInt(gas.cancelUnfunded) < ABI_MINIMUM_GAS.cancelUnfunded) problems.push("GAS_BELOW_ABI_MINIMUM");
  return problems;
}

/**
 * A wallet-neutral description of ONE contract function call. Nothing here signs,
 * broadcasts or holds keys: a wallet shows it to the person, who approves or not.
 */
export interface PreparedContractCall {
  receiverId: string;
  methodName: "create_request" | "pay_instant_native" | "retry_native_transfer" | "cancel_unfunded";
  args: Record<string, unknown>;
  gas: string;
  depositYocto: string;
}

function refuse(): never {
  throw new NearClientError("INVALID_ARGUMENT", false);
}

function instantTerms(contractId: string, terms: IntentTerms): IntentTerms {
  const parsed = IntentTermsSchema.safeParse(terms);
  if (!parsed.success) refuse();
  const value = parsed.data;
  // Phase 2B contract: native Instant only, no merchant/session binding.
  if (value.contractId !== contractId || value.mode !== "instant" || value.cancelDurationNs !== null
    || value.merchantAccountId !== null || value.sessionBinding !== null) refuse();
  return value;
}

function checkedArgs<K extends keyof typeof ContractMethodArgs>(method: K, args: unknown): Record<string, unknown> {
  const parsed = ContractMethodArgs[method].safeParse(args);
  if (!parsed.success) refuse();
  return parsed.data as Record<string, unknown>;
}

/** Recipient signs creation with exactly the quoted permanent storage bond. */
export function prepareCreateRequest(input: {
  contractId: string; config: ContractConfig; terms: IntentTerms; quote: CreateQuote; signerAccountId: string;
}): PreparedContractCall {
  const terms = instantTerms(input.contractId, input.terms);
  const quote = CreateQuoteSchema.safeParse(input.quote);
  if (!quote.success) refuse();
  const { requestId, termsHash, quoteVersion, depositYocto, gas } = quote.data;
  if (input.signerAccountId !== terms.creatorAccountId) refuse();
  if (requestId !== terms.id || termsHash !== calculateTermsHash(terms) || quoteVersion !== input.config.quoteVersion) refuse();
  if (BigInt(gas) < BigInt(input.config.gas.createRequest)) refuse();
  return { receiverId: input.contractId, methodName: "create_request", gas, depositYocto,
    args: checkedArgs("create_request", { terms, quoteVersion }) };
}

/** Payer attaches EXACTLY the principal: no fee, overpayment or gas mixed in. */
export function preparePayInstantNative(input: {
  contractId: string; config: ContractConfig; request: ContractRequest; signerAccountId: string; observedAtNs: string;
}): PreparedContractCall {
  const parsed = ContractRequestSchema.safeParse(input.request);
  if (!parsed.success || !U64Schema.safeParse(input.observedAtNs).success) refuse();
  const request = parsed.data;
  const terms = instantTerms(input.contractId, request.terms);
  if (request.status !== "OPEN" || BigInt(input.observedAtNs) >= BigInt(terms.fundingExpiresAtNs)) refuse();
  if (terms.permittedPayerAccountId !== null && terms.permittedPayerAccountId !== input.signerAccountId) refuse();
  return { receiverId: input.contractId, methodName: "pay_instant_native", gas: input.config.gas.payInstantNative,
    depositYocto: terms.amountBaseUnits,
    args: checkedArgs("pay_instant_native", { id: terms.id, expectedTermsHash: request.termsHash }) };
}

/** Recipient-only retry of a RECORDED transfer failure, same nonce the contract holds. */
export function prepareRetryNativeTransfer(input: {
  contractId: string; config: ContractConfig; request: ContractRequest; signerAccountId: string;
}): PreparedContractCall {
  const parsed = ContractRequestSchema.safeParse(input.request);
  if (!parsed.success) refuse();
  const request = parsed.data;
  const terms = instantTerms(input.contractId, request.terms);
  const op = request.latestOperation;
  if (request.status !== "PAYOUT_FAILED_RECOVERABLE" || op === null || op.status !== "FAILED"
    || op.kind !== "INSTANT_PAYOUT" || input.signerAccountId !== request.recipientAccountId) refuse();
  return { receiverId: input.contractId, methodName: "retry_native_transfer", gas: input.config.gas.retryNativeTransfer,
    depositYocto: "1", args: checkedArgs("retry_native_transfer", { id: terms.id, expectedOperationNonce: op.nonce }) };
}

/** Creator-only cancellation of an unfunded OPEN request. No principal moves. */
export function prepareCancelUnfunded(input: {
  contractId: string; config: ContractConfig; request: ContractRequest; signerAccountId: string;
}): PreparedContractCall {
  const parsed = ContractRequestSchema.safeParse(input.request);
  if (!parsed.success) refuse();
  const request = parsed.data;
  const terms = instantTerms(input.contractId, request.terms);
  if (request.status !== "OPEN" || input.signerAccountId !== request.recipientAccountId) refuse();
  return { receiverId: input.contractId, methodName: "cancel_unfunded", gas: input.config.gas.cancelUnfunded,
    depositYocto: "1", args: checkedArgs("cancel_unfunded", { id: terms.id, expectedTermsHash: request.termsHash }) };
}
