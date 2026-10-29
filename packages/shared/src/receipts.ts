import { z } from "zod";
import { AccountIdSchema, AmountSchema, AssetIdSchema, HashHexSchema, NetworkSchema,
  PayModeSchema, PositiveU64Schema, SessionIdSchema, UtcDateTimeSchema } from "./primitives.js";
import { BlockRefSchema, ChainHashSchema } from "./payments.js";

export const TransactionRefSchema = z.strictObject({ hash: ChainHashSchema, signerAccountId: AccountIdSchema });
export const ReceiptOutcomeRefSchema = z.strictObject({
  receiptId: ChainHashSchema,
  executorAccountId: AccountIdSchema,
  block: BlockRefSchema,
  outcome: z.enum(["SUCCESS", "FAILURE"]),
});

/** Validates evidence shape/consistency, NOT authenticity. A trusted RPC verifier must fill it. */
export const VerifiedReceiptSchema = z.strictObject({
  schemaVersion: z.literal("taply.receipt.v1"),
  requestId: HashHexSchema,
  termsHash: HashHexSchema,
  sessionId: SessionIdSchema.nullable(),
  network: NetworkSchema,
  contractId: AccountIdSchema,
  contractCodeHash: ChainHashSchema,
  mode: PayModeSchema,
  finalStatus: z.enum(["FINAL_PAID", "CANCELLED_REFUNDED"]),
  payerAccountId: AccountIdSchema,
  recipientAccountId: AccountIdSchema,
  settlementBeneficiaryAccountId: AccountIdSchema,
  assetId: AssetIdSchema,
  amountBaseUnits: AmountSchema,
  operationNonce: PositiveU64Schema,
  fundingTransaction: TransactionRefSchema,
  fundingReceipt: ReceiptOutcomeRefSchema,
  settlementTransaction: TransactionRefSchema,
  transferReceipt: ReceiptOutcomeRefSchema,
  callbackReceipt: ReceiptOutcomeRefSchema,
  contractStateBlock: BlockRefSchema,
  verification: z.strictObject({
    state: z.literal("verified_final"),
    executionFinality: z.literal("FINAL"),
    trustModel: z.literal("configured-rpc"),
    rpcProviderId: z.string().min(1).max(128),
    checkedAt: UtcDateTimeSchema,
  }),
}).superRefine((receipt, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const refund = receipt.finalStatus === "CANCELLED_REFUNDED";
  if (refund && receipt.mode !== "protected") issue("Instant payer refund is unsupported");
  if (receipt.settlementBeneficiaryAccountId !== (refund ? receipt.payerAccountId : receipt.recipientAccountId))
    issue("Settlement beneficiary mismatch");
  if (receipt.fundingTransaction.signerAccountId !== receipt.payerAccountId) issue("Funding signer is not payer");
  if (receipt.fundingReceipt.executorAccountId !== receipt.contractId || receipt.callbackReceipt.executorAccountId !== receipt.contractId)
    issue("Funding/callback executor must be approved contract");
  if (receipt.transferReceipt.executorAccountId !== receipt.settlementBeneficiaryAccountId) issue("Transfer executor is not beneficiary");
  const outcomes = [receipt.fundingReceipt, receipt.transferReceipt, receipt.callbackReceipt];
  if (outcomes.some((outcome) => outcome.outcome !== "SUCCESS")) issue("Final receipt requires successful funding, transfer, and callback");
  if (new Set(outcomes.map((outcome) => outcome.receiptId)).size !== 3) issue("Funding, transfer, callback must identify distinct receipts");
  const blocks = [...outcomes.map((outcome) => outcome.block), receipt.contractStateBlock];
  if (blocks.every((block) => BlockRefSchema.safeParse(block).success)) {
    for (let index = 1; index < blocks.length; index++) {
      const before = blocks[index - 1]!;
      const after = blocks[index]!;
      if (BigInt(after.height) < BigInt(before.height) || BigInt(after.timestampNs) < BigInt(before.timestampNs))
        issue("Receipt/state provenance is out of order");
    }
  }
});

export type TransactionRef = z.infer<typeof TransactionRefSchema>;
export type ReceiptOutcomeRef = z.infer<typeof ReceiptOutcomeRefSchema>;
export type VerifiedReceipt = z.infer<typeof VerifiedReceiptSchema>;
