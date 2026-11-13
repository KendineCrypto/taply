import { z } from "zod";
import { AccountIdSchema, AmountSchema, HashHexSchema, MemoSchema, PositiveU64Schema, U64Schema } from "./primitives.js";
import { OperationRecordSchema } from "./payments.js";
import { canonicalJson, domainHash } from "./json.js";

export const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const MAINNET_USDC_ASSET = `nep141:${MAINNET_USDC}` as const;
export const MAINNET_NATIVE_CAP = "1000000000000000000000000";
export const MAINNET_USDC_CAP = "25000000";
export const MainnetAccountSchema = AccountIdSchema.refine(v => !v.endsWith(".testnet") && !v.endsWith(".test"), "Testnet account forbidden");
export const MainnetContractIdSchema = z.enum(["taply-pay.kendinecrypto.near", "devkendinecrypto.near"]);
const identity = z.strictObject({ contractId: MainnetContractIdSchema, creationNonce: HashHexSchema,
  creatorAccountId: MainnetAccountSchema, network: z.literal("near-mainnet") });
export function calculateMainnetRequestId(input: z.infer<typeof identity>): string {
  return domainHash("taply.id.v1", canonicalJson(identity.parse(input)));
}
export const MainnetIntentTermsSchema = z.strictObject({
  schemaVersion: z.literal("taply.intent.v1"), id: HashHexSchema, network: z.literal("near-mainnet"),
  contractId: MainnetContractIdSchema, creationNonce: HashHexSchema, creatorAccountId: MainnetAccountSchema,
  assetId: z.enum(["near:native", MAINNET_USDC_ASSET]), amountBaseUnits: AmountSchema,
  mode: z.literal("instant"), cancelDurationNs: z.null(), fundingExpiresAtNs: PositiveU64Schema,
  permittedPayerAccountId: MainnetAccountSchema.nullable(), merchantAccountId: z.null(), memo: MemoSchema, sessionBinding: z.null(),
}).superRefine((t, ctx) => {
  if (!AmountSchema.safeParse(t.amountBaseUnits).success) return;
  if (t.creatorAccountId === t.contractId) ctx.addIssue({ code: "custom", message: "SELF_RECIPIENT" });
  if (BigInt(t.amountBaseUnits) > BigInt(t.assetId === "near:native" ? MAINNET_NATIVE_CAP : MAINNET_USDC_CAP))
    ctx.addIssue({ code: "custom", message: "CAP_EXCEEDED" });
  const parsedIdentity = identity.safeParse({ contractId: t.contractId, creationNonce: t.creationNonce,
    creatorAccountId: t.creatorAccountId, network: t.network });
  if (parsedIdentity.success && t.id !== calculateMainnetRequestId(parsedIdentity.data)) ctx.addIssue({ code: "custom", message: "REQUEST_ID_MISMATCH" });
});
export type MainnetIntentTerms = z.infer<typeof MainnetIntentTermsSchema>;
export function calculateMainnetTermsHash(input: MainnetIntentTerms): string {
  return domainHash("taply.terms.v1", canonicalJson(MainnetIntentTermsSchema.parse(input)));
}
/** The identical serialized string is used by NEAR wallet funding and 1Click. */
export function buildInstantRecipientMessage(id: string, expectedTermsHash: string): string {
  return JSON.stringify({ id: HashHexSchema.parse(id), expectedTermsHash: HashHexSchema.parse(expectedTermsHash), action: "pay_instant" });
}
export const MainnetRequestSchema = z.strictObject({
  terms: MainnetIntentTermsSchema, termsHash: HashHexSchema, sessionCommitment: z.null(),
  recipientAccountId: MainnetAccountSchema,
  status: z.enum(["OPEN", "CANCELLED_UNFUNDED", "PAYOUT_IN_FLIGHT", "PAYOUT_FAILED_RECOVERABLE", "FINAL_PAID"]),
  revision: PositiveU64Schema, createdAtNs: U64Schema, payerAccountId: MainnetAccountSchema.nullable(),
  fundedAtNs: U64Schema.nullable(), cancelUntilNs: z.null(), settlementBranch: z.literal("RECIPIENT").nullable(),
  latestOperation: OperationRecordSchema.nullable(),
}).superRefine((r, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!MainnetIntentTermsSchema.safeParse(r.terms).success || !U64Schema.safeParse(r.createdAtNs).success) return;
  if (r.termsHash !== calculateMainnetTermsHash(r.terms) || r.recipientAccountId !== r.terms.creatorAccountId) issue("REQUEST_BINDING_MISMATCH");
  const lifetime = BigInt(r.terms.fundingExpiresAtNs) - BigInt(r.createdAtNs);
  if (lifetime <= 0n || lifetime > 86400000000000n) issue("INVALID_LIFETIME");
  if (r.status === "OPEN" || r.status === "CANCELLED_UNFUNDED") {
    if (r.payerAccountId !== null || r.fundedAtNs !== null || r.latestOperation !== null || r.settlementBranch !== null) issue("UNFUNDED_HAS_PAYMENT");
    return;
  }
  const op = OperationRecordSchema.safeParse(r.latestOperation);
  if (!op.success || r.payerAccountId === null || r.fundedAtNs === null || !U64Schema.safeParse(r.fundedAtNs).success) { issue("MISSING_PAYMENT"); return; }
  if (r.settlementBranch !== "RECIPIENT" || op.data.kind !== "INSTANT_PAYOUT" || op.data.destinationAccountId !== r.recipientAccountId || op.data.amountBaseUnits !== r.terms.amountBaseUnits) issue("PAYOUT_MISMATCH");
  if (r.terms.permittedPayerAccountId !== null && r.terms.permittedPayerAccountId !== r.payerAccountId) issue("WRONG_PAYER");
  if (BigInt(r.fundedAtNs) < BigInt(r.createdAtNs) || BigInt(op.data.startedAtNs) < BigInt(r.fundedAtNs)) issue("INVALID_TIMES");
  if (BigInt(r.fundedAtNs) >= BigInt(r.terms.fundingExpiresAtNs) && !(r.payerAccountId === "intents.near" && r.terms.assetId === MAINNET_USDC_ASSET)) issue("EXPIRED_DIRECT_PAYMENT");
  const expected = r.status === "FINAL_PAID" ? "SUCCEEDED" : r.status === "PAYOUT_IN_FLIGHT" ? "IN_FLIGHT" : "FAILED";
  if (op.data.status !== expected) issue("OUTCOME_MISMATCH");
});
