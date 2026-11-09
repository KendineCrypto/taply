import { z } from "zod";
import {
  AccountIdSchema, AmountSchema, HashHexSchema, MAX_FUNDING_LIFETIME_NS,
  PositiveU64Schema, U64Schema, U64_MAX, UtcDateTimeSchema,
} from "./primitives.js";
import { IntentTermsSchema, calculateSessionCommitment, calculateTermsHash } from "./terms.js";

export const CHAIN_STATES = [
  "OPEN", "CANCELLED_UNFUNDED", "PAYOUT_IN_FLIGHT", "PAYOUT_FAILED_RECOVERABLE",
  "LOCKED", "REFUND_IN_FLIGHT", "REFUND_FAILED_RECOVERABLE", "RELEASE_IN_FLIGHT",
  "RELEASE_FAILED_RECOVERABLE", "FINAL_PAID", "CANCELLED_REFUNDED",
] as const;
export const ChainStateSchema = z.enum(CHAIN_STATES);
export const LocalWalletStateSchema = z.enum(["AWAITING_SIGNATURE", "USER_REJECTED", "OUTCOME_UNKNOWN"]);
export const OperationKindSchema = z.enum(["INSTANT_PAYOUT", "PROTECTED_RELEASE", "PROTECTED_REFUND"]);

export const OperationRecordSchema = z.strictObject({
  nonce: PositiveU64Schema,
  kind: OperationKindSchema,
  destinationAccountId: AccountIdSchema,
  amountBaseUnits: AmountSchema,
  status: z.enum(["IN_FLIGHT", "FAILED", "SUCCEEDED"]),
  startedAtNs: U64Schema,
  resolvedAtNs: U64Schema.nullable(),
  failureCode: z.enum(["NATIVE_TRANSFER_FAILED", "FT_TRANSFER_FAILED"]).nullable(),
}).superRefine((op, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((op.status === "IN_FLIGHT") !== (op.resolvedAtNs === null)) issue("Only in-flight operations have no resolution time");
  if ((op.status === "FAILED") !== (op.failureCode !== null)) issue("Only recorded failures have failure codes");
  if (U64Schema.safeParse(op.startedAtNs).success && op.resolvedAtNs !== null && U64Schema.safeParse(op.resolvedAtNs).success
    && BigInt(op.resolvedAtNs) < BigInt(op.startedAtNs)) issue("Resolution precedes operation");
});

export const ContractRequestSchema = z.strictObject({
  terms: IntentTermsSchema,
  termsHash: HashHexSchema,
  sessionCommitment: HashHexSchema.nullable(),
  recipientAccountId: AccountIdSchema,
  status: ChainStateSchema,
  revision: PositiveU64Schema,
  createdAtNs: U64Schema,
  payerAccountId: AccountIdSchema.nullable(),
  fundedAtNs: U64Schema.nullable(),
  cancelUntilNs: U64Schema.nullable(),
  settlementBranch: z.enum(["RECIPIENT", "PAYER"]).nullable(),
  latestOperation: OperationRecordSchema.nullable(),
}).superRefine((request, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  // Nested refinements may have failed without aborting Zod; never BigInt/hash invalid values.
  const validTerms = IntentTermsSchema.safeParse(request.terms);
  const times = [request.createdAtNs, request.fundedAtNs, request.cancelUntilNs].filter((v) => v !== null);
  if (!validTerms.success || !times.every((v) => U64Schema.safeParse(v).success)) return;
  const terms = validTerms.data;
  if (request.termsHash !== calculateTermsHash(terms)) issue("Terms hash mismatch");
  if (request.sessionCommitment !== calculateSessionCommitment(terms)) issue("Session commitment mismatch");
  if (request.recipientAccountId !== terms.creatorAccountId) issue("Recipient must be creator");
  const lifetime = BigInt(terms.fundingExpiresAtNs) - BigInt(request.createdAtNs);
  if (lifetime <= 0n || lifetime > MAX_FUNDING_LIFETIME_NS) issue("Funding lifetime must be positive and at most 24 hours");
  const unfunded = request.status === "OPEN" || request.status === "CANCELLED_UNFUNDED";
  if (unfunded) {
    if (request.payerAccountId !== null || request.fundedAtNs !== null || request.cancelUntilNs !== null
      || request.settlementBranch !== null || request.latestOperation !== null) issue("Unfunded state contains funded fields");
    return;
  }
  if (request.payerAccountId === null || request.fundedAtNs === null) { issue("Funded state requires payer and funding time"); return; }
  if (terms.permittedPayerAccountId !== null && terms.permittedPayerAccountId !== request.payerAccountId) issue("Payer restriction mismatch");
  if (BigInt(request.fundedAtNs) < BigInt(request.createdAtNs) || BigInt(request.fundedAtNs) >= BigInt(terms.fundingExpiresAtNs))
    issue("Funding execution outside request lifetime");
  if (terms.mode === "protected") {
    const cutoff = BigInt(request.fundedAtNs) + BigInt(terms.cancelDurationNs!);
    if (cutoff > U64_MAX || request.cancelUntilNs !== cutoff.toString()) issue("Cutoff must equal funding time plus immutable duration");
  } else if (request.cancelUntilNs !== null) issue("Instant cannot have cutoff");
  if (request.status === "LOCKED") {
    if (terms.mode !== "protected" || request.settlementBranch !== null || request.latestOperation !== null) issue("Invalid locked state");
    return;
  }
  const parsedOperation = OperationRecordSchema.safeParse(request.latestOperation);
  if (!parsedOperation.success) { issue("Outgoing/terminal state needs valid operation"); return; }
  const op = parsedOperation.data;
  const refund = request.status.startsWith("REFUND_") || request.status === "CANCELLED_REFUNDED";
  const kind = refund ? "PROTECTED_REFUND" : terms.mode === "instant" ? "INSTANT_PAYOUT" : "PROTECTED_RELEASE";
  if ((terms.mode === "instant" && (refund || request.status.startsWith("RELEASE_")))
    || (terms.mode === "protected" && request.status.startsWith("PAYOUT_"))) issue("State does not belong to mode");
  if (request.settlementBranch !== (refund ? "PAYER" : "RECIPIENT") || op.kind !== kind) issue("Branch/operation mismatch");
  if (op.destinationAccountId !== (refund ? request.payerAccountId : request.recipientAccountId)) issue("Operation beneficiary mismatch");
  if (op.amountBaseUnits !== terms.amountBaseUnits) issue("Operation principal mismatch");
  if (op.failureCode !== null && (op.failureCode === "FT_TRANSFER_FAILED") !== (terms.assetId !== "near:native"))
    issue("Failure code does not match the asset");
  const expectedStatus = request.status.endsWith("_IN_FLIGHT") ? "IN_FLIGHT"
    : request.status.endsWith("_FAILED_RECOVERABLE") ? "FAILED" : "SUCCEEDED";
  if (op.status !== expectedStatus) issue("Operation result does not match payment state");
  if (BigInt(op.startedAtNs) < BigInt(request.fundedAtNs)) issue("Operation precedes funding");
  if (terms.mode === "protected" && request.cancelUntilNs !== null) {
    // Only first refund initiation is cutoff-bound: refund retries may occur afterwards.
    if (refund && op.nonce === "1" && BigInt(op.startedAtNs) >= BigInt(request.cancelUntilNs)) issue("Initial refund started at/after cutoff");
    if (!refund && BigInt(op.startedAtNs) < BigInt(request.cancelUntilNs)) issue("Release started before cutoff");
  }
});

// Base58 syntax only. Receipt authenticity and decoded cryptographic hashes require RPC verification.
export const ChainHashSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const BlockRefSchema = z.strictObject({ hash: ChainHashSchema, height: U64Schema, timestampNs: U64Schema });
export const VerificationDiagnosticSchema = z.strictObject({
  differences: z.array(z.strictObject({
    field: z.enum(["network", "contractId", "codeHash", "requestId", "termsHash", "recipientAccountId",
      "payerAccountId", "assetId", "amountBaseUnits", "mode", "cancelDurationNs", "sessionCommitment", "status"]),
    expected: z.string().max(256).nullable(),
    observed: z.string().max(256).nullable(),
  })).min(1).max(16),
});

const ObservationMetadataSchema = z.strictObject({
  source: z.enum(["rpc", "index", "mock"]),
  assurance: z.enum(["unverified", "pending_finality", "verified_final", "unknown", "mismatch"]),
  observedBlock: BlockRefSchema.nullable(),
  checkedAt: UtcDateTimeSchema,
  stale: z.boolean(),
  rpcAvailable: z.boolean(),
  diagnostic: VerificationDiagnosticSchema.optional(),
});

export function createChainObservationSchema<T extends z.ZodType>(dataSchema: T) {
  return ObservationMetadataSchema.extend({ data: dataSchema.nullable() }).superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const data: unknown = Reflect.get(value, "data");
    if (data === undefined) issue("Observation data must be explicit, including null");
    if (value.source === "mock" && (value.assurance !== "unverified" || value.observedBlock !== null)) issue("Mock data cannot claim chain verification");
    if ((value.assurance === "verified_final" || value.assurance === "pending_finality")
      && (data === null || data === undefined || value.observedBlock === null)) issue("Observed chain state requires data and block provenance");
    if (value.diagnostic !== undefined && value.assurance !== "mismatch") issue("Differences belong to mismatch observations");
    if (!value.rpcAvailable && value.assurance === "verified_final" && !value.stale) issue("Unavailable RPC must expose stale historical observation");
  });
}

export const CallerRoleSchema = z.enum(["anonymous", "payer", "recipient", "payer_and_recipient", "observer"]);
export const DerivedPaymentActionsSchema = z.strictObject({
  callerRole: CallerRoleSchema,
  cancelWindowOpen: z.boolean().nullable(),
  releaseEligible: z.boolean().nullable(),
  retry: z.strictObject({
    eligible: z.boolean(),
    operationNonce: PositiveU64Schema.nullable(),
    kind: OperationKindSchema.nullable(),
  }),
});

export const PaymentIntentResponseSchema = z.strictObject({
  observation: createChainObservationSchema(ContractRequestSchema),
  fundingEligibility: z.enum(["ELIGIBLE", "EXPIRED", "NOT_OPEN", "UNSUPPORTED", "UNKNOWN"]),
  incident: z.enum(["CALLBACK_FAILED", "OUTCOME_UNKNOWN", "RECONCILIATION_REQUIRED"]).nullable(),
  derived: DerivedPaymentActionsSchema,
}).superRefine((response, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const { observation, derived } = response;
  const fresh = observation.assurance === "verified_final" && !observation.stale && observation.rpcAvailable && response.incident === null;
  const request = ContractRequestSchema.safeParse(observation.data);
  const block = BlockRefSchema.safeParse(observation.observedBlock);
  if (request.success && block.success) {
    const data = request.data;
    const times = [data.createdAtNs, data.fundedAtNs, data.latestOperation?.startedAtNs, data.latestOperation?.resolvedAtNs];
    if (times.some((time) => time != null && BigInt(time) > BigInt(block.data.timestampNs)))
      issue("Observation block precedes the state it claims to contain");
  }
  if (!fresh || !request.success || !block.success) {
    if (response.fundingEligibility === "ELIGIBLE" || derived.cancelWindowOpen === true || derived.releaseEligible === true || derived.retry.eligible)
      issue("Uncertain/mock/stale observations cannot enable financial actions");
    return;
  }
  const value = request.data;
  const now = BigInt(block.data.timestampNs);
  if (response.fundingEligibility === "ELIGIBLE" && (value.status !== "OPEN" || now >= BigInt(value.terms.fundingExpiresAtNs)))
    issue("Funding not eligible at observed block");
  if (derived.cancelWindowOpen === true && (value.status !== "LOCKED" || value.cancelUntilNs === null || now >= BigInt(value.cancelUntilNs)))
    issue("Cancellation window not open at observed block");
  if (derived.releaseEligible === true && (value.status !== "LOCKED" || value.cancelUntilNs === null || now < BigInt(value.cancelUntilNs)))
    issue("Release not eligible at observed block");
  if (derived.retry.eligible) {
    const op = value.latestOperation;
    const role = derived.callerRole;
    if (!value.status.endsWith("_FAILED_RECOVERABLE") || !op || op.status !== "FAILED"
      || derived.retry.operationNonce !== op.nonce || derived.retry.kind !== op.kind
      || !(role === "payer_and_recipient" || role === (op.kind === "PROTECTED_REFUND" ? "payer" : "recipient")))
      issue("Retry requires matching recorded failure and beneficiary role");
  }
});

export type ChainState = z.infer<typeof ChainStateSchema>;
export type LocalWalletState = z.infer<typeof LocalWalletStateSchema>;
export type OperationKind = z.infer<typeof OperationKindSchema>;
export type OperationRecord = z.infer<typeof OperationRecordSchema>;
export type ContractRequest = z.infer<typeof ContractRequestSchema>;
export type BlockRef = z.infer<typeof BlockRefSchema>;
export type ChainObservation<T> = z.infer<typeof ObservationMetadataSchema> & { data: T | null };
export type CallerRole = z.infer<typeof CallerRoleSchema>;
export type DerivedPaymentActions = z.infer<typeof DerivedPaymentActionsSchema>;
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;
