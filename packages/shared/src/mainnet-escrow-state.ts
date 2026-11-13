import { z } from 'zod';
import { HashHexSchema, MAX_FUNDING_LIFETIME_NS, PositiveU64Schema, U64Schema, U64_MAX } from './primitives.js';
import { MainnetAccountSchema } from './mainnet.js';
import { MainnetEscrowTermsSchema, calculateMainnetEscrowTermsHash } from './mainnet-escrow.js';
import { ChainStateSchema, OperationRecordSchema } from './payments.js';
export const MainnetEscrowRequestSchema = z.strictObject({
  terms: MainnetEscrowTermsSchema,
  termsHash: HashHexSchema,
  sessionCommitment: HashHexSchema.nullable(),
  recipientAccountId: MainnetAccountSchema,
  status: ChainStateSchema,
  revision: PositiveU64Schema,
  createdAtNs: U64Schema,
  payerAccountId: MainnetAccountSchema.nullable(),
  fundedAtNs: U64Schema.nullable(),
  cancelUntilNs: U64Schema.nullable(),
  settlementBranch: z.enum(["RECIPIENT", "PAYER"]).nullable(),
  latestOperation: OperationRecordSchema.nullable(),
}).superRefine((request, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  // Nested refinements may have failed without aborting Zod; never BigInt/hash invalid values.
  const validTerms = MainnetEscrowTermsSchema.safeParse(request.terms);
  const times = [request.createdAtNs, request.fundedAtNs, request.cancelUntilNs].filter((v) => v !== null);
  if (!validTerms.success || !times.every((v) => U64Schema.safeParse(v).success)) return;
  const terms = validTerms.data;
  if (request.termsHash !== calculateMainnetEscrowTermsHash(terms)) issue("Terms hash mismatch");
  if (request.sessionCommitment !== null) issue("Session commitment mismatch");
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


export type MainnetEscrowRequest = z.infer<typeof MainnetEscrowRequestSchema>;

