import { z } from "zod";
import { HashHexSchema, MIN_CANCEL_DURATION_NS, MAX_CANCEL_DURATION_NS, PositiveU64Schema, U64Schema } from "./primitives.js";
import { IntentTermsSchema } from "./terms.js";
import { OperationKindSchema } from "./payments.js";

export const RequestIdArgsSchema = z.strictObject({ id: HashHexSchema });
export const ExpectedTermsArgsSchema = z.strictObject({ id: HashHexSchema, expectedTermsHash: HashHexSchema });
export const CreateRequestArgsSchema = z.strictObject({ terms: IntentTermsSchema, quoteVersion: PositiveU64Schema });
export const QuoteCreateRequestArgsSchema = z.strictObject({ terms: IntentTermsSchema });
export const FundProtectedNativeArgsSchema = ExpectedTermsArgsSchema.extend({
  acceptedCancelDurationNs: U64Schema.refine((value) => {
    const parsed = U64Schema.safeParse(value);
    return parsed.success && BigInt(value) >= MIN_CANCEL_DURATION_NS && BigInt(value) <= MAX_CANCEL_DURATION_NS;
  }),
  consentVersion: z.literal("taply.protected-consent.v1"),
});
export const RetryNativeTransferArgsSchema = z.strictObject({ id: HashHexSchema, expectedOperationNonce: PositiveU64Schema });
export const NativeTransferCallbackArgsSchema = z.strictObject({
  id: HashHexSchema, operationNonce: PositiveU64Schema, kind: OperationKindSchema,
});

// Argument shapes only, not a method dispatcher, transaction builder, or authorization check.
export const ContractMethodArgs = Object.freeze({
  get_config: z.strictObject({}),
  quote_create_request: QuoteCreateRequestArgsSchema,
  create_request: CreateRequestArgsSchema,
  cancel_unfunded: ExpectedTermsArgsSchema,
  pay_instant_native: ExpectedTermsArgsSchema,
  fund_protected_native: FundProtectedNativeArgsSchema,
  cancel_protected: ExpectedTermsArgsSchema,
  release_protected: RequestIdArgsSchema,
  retry_native_transfer: RetryNativeTransferArgsSchema,
  get_request: RequestIdArgsSchema,
  get_receipt: RequestIdArgsSchema,
  on_native_transfer_complete: NativeTransferCallbackArgsSchema,
});

export type FundProtectedNativeArgs = z.infer<typeof FundProtectedNativeArgsSchema>;
export type RetryNativeTransferArgs = z.infer<typeof RetryNativeTransferArgsSchema>;
