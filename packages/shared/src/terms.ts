import { z } from "zod";
import {
  AccountIdSchema, AmountSchema, AssetIdSchema, HashHexSchema, INTENT_VERSION,
  MAX_CANCEL_DURATION_NS, MIN_CANCEL_DURATION_NS, MemoSchema, NetworkSchema,
  PayModeSchema, PositiveU64Schema, SessionIdSchema, U64Schema,
} from "./primitives.js";
import { canonicalJson, domainHash, parseStrictJson } from "./json.js";

export const IntentIdentitySchema = z.strictObject({
  contractId: AccountIdSchema,
  creationNonce: HashHexSchema,
  creatorAccountId: AccountIdSchema,
  network: NetworkSchema,
});
export type IntentIdentity = z.infer<typeof IntentIdentitySchema>;

export function calculateRequestId(identity: IntentIdentity): string {
  return domainHash("taply.id.v1", canonicalJson(IntentIdentitySchema.parse(identity)));
}

export const SessionBindingSchema = z.strictObject({
  id: SessionIdSchema,
  nonce: HashHexSchema,
  expiresAtNs: PositiveU64Schema,
});

export const IntentTermsSchema = z.strictObject({
  schemaVersion: z.literal(INTENT_VERSION),
  id: HashHexSchema,
  network: NetworkSchema,
  contractId: AccountIdSchema,
  creationNonce: HashHexSchema,
  creatorAccountId: AccountIdSchema,
  assetId: AssetIdSchema,
  amountBaseUnits: AmountSchema,
  mode: PayModeSchema,
  cancelDurationNs: U64Schema.nullable(),
  fundingExpiresAtNs: PositiveU64Schema,
  permittedPayerAccountId: AccountIdSchema.nullable(),
  merchantAccountId: AccountIdSchema.nullable(),
  memo: MemoSchema,
  sessionBinding: SessionBindingSchema.nullable(),
}).superRefine((terms, ctx) => {
  const invalid = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
  if (terms.creatorAccountId === terms.contractId) invalid("creatorAccountId", "Recipient cannot be payments contract");
  if (terms.merchantAccountId !== null && terms.merchantAccountId !== terms.creatorAccountId)
    invalid("merchantAccountId", "Merchant must be creator/recipient");
  if (terms.mode === "instant" && terms.cancelDurationNs !== null)
    invalid("cancelDurationNs", "Instant has no cancellation duration");
  if (terms.mode === "protected") {
    const parsed = U64Schema.safeParse(terms.cancelDurationNs);
    if (!parsed.success || BigInt(parsed.data) < MIN_CANCEL_DURATION_NS || BigInt(parsed.data) > MAX_CANCEL_DURATION_NS)
      invalid("cancelDurationNs", "Protected duration must be 60-3600 seconds in nanoseconds");
  }
  const identity = IntentIdentitySchema.safeParse({
    contractId: terms.contractId, creationNonce: terms.creationNonce,
    creatorAccountId: terms.creatorAccountId, network: terms.network,
  });
  if (identity.success && terms.id !== calculateRequestId(identity.data))
    invalid("id", "Request ID does not match creator-scoped identity");
});

export type SessionBinding = z.infer<typeof SessionBindingSchema>;
export type IntentTerms = z.infer<typeof IntentTermsSchema>;

export function parseIntentTermsJson(input: string | Uint8Array): IntentTerms {
  return IntentTermsSchema.parse(parseStrictJson(input));
}

export function calculateTermsHash(input: IntentTerms): string {
  return domainHash("taply.terms.v1", canonicalJson(IntentTermsSchema.parse(input)));
}

export function calculateSessionCommitment(input: IntentTerms): string | null {
  const terms = IntentTermsSchema.parse(input);
  return terms.sessionBinding === null ? null : domainHash("taply.session.v1", calculateTermsHash(terms));
}

export function comparisonCode(commitment: string): string {
  HashHexSchema.parse(commitment);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  // This is a bounded 32-bit hash prefix, never an amount/timestamp conversion.
  const bits = Number.parseInt(commitment.slice(0, 8), 16) >>> 2;
  return [25, 20, 15, 10, 5, 0].map((shift) => alphabet[(bits >>> shift) & 31]).join("");
}
