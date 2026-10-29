import { z } from "zod";
import { AccountIdSchema, U128Schema, type BlockRef } from "@taply/shared";
import { NearClientError, type createRpc } from "./rpc.js";
import { BlockSchema, HashSchema, RpcU64Schema, TransactionRefSchema, losslessStringify } from "./validation.js";
import type { ExecutionOutcome, ExecutionStatus, TransactionObservation, TransactionRef } from "./types.js";

const StatusSchema: z.ZodType<ExecutionStatus> = z.union([
  z.strictObject({ SuccessValue: z.string().max(1_048_576).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) })
    .transform(({ SuccessValue }) => ({ kind: "SUCCESS_VALUE" as const, valueBase64: SuccessValue })),
  z.strictObject({ SuccessReceiptId: HashSchema })
    .transform(({ SuccessReceiptId }) => ({ kind: "SUCCESS_RECEIPT_ID" as const, receiptId: SuccessReceiptId })),
  z.strictObject({ Failure: z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length > 0) })
    .transform(({ Failure }) => ({ kind: "FAILURE" as const, detailJson: losslessStringify(Failure) })),
  z.enum(["Unknown", "NotStarted", "Started"]).transform(() => ({ kind: "UNKNOWN" as const })),
]);
const OutcomeSchema = z.object({
  id: HashSchema, block_hash: HashSchema,
  outcome: z.object({
    executor_id: AccountIdSchema, receipt_ids: z.array(HashSchema).max(256), status: StatusSchema,
    logs: z.array(z.string().max(16_384)).max(1024), gas_burnt: RpcU64Schema, tokens_burnt: U128Schema,
  }),
}).transform(({ id, block_hash, outcome }): ExecutionOutcome => ({
  id, blockHash: block_hash, executorAccountId: outcome.executor_id, receiptIds: outcome.receipt_ids,
  status: outcome.status, logs: outcome.logs, gasBurnt: outcome.gas_burnt, tokensBurntYoctoNear: outcome.tokens_burnt,
}));
const TransactionSchema = z.object({
  final_execution_status: z.enum(["NONE", "INCLUDED", "EXECUTED_OPTIMISTIC", "INCLUDED_FINAL", "EXECUTED", "FINAL"]),
  status: StatusSchema,
  transaction: z.object({ hash: HashSchema, signer_id: AccountIdSchema, receiver_id: AccountIdSchema }),
  transaction_outcome: OutcomeSchema, receipts_outcome: z.array(OutcomeSchema).max(256),
});

/** Check receipt outcomes form one rooted tree. Missing evidence never means failed payment. */
function reconcile(root: ExecutionOutcome, receipts: readonly ExecutionOutcome[]): boolean {
  const nodes = new Map<string, ExecutionOutcome>([[root.id, root]]);
  for (const receipt of receipts) {
    if (nodes.has(receipt.id)) throw new NearClientError("EVIDENCE_MISMATCH");
    nodes.set(receipt.id, receipt);
  }
  const visited = new Set<string>();
  const pending = [root.id];
  let complete = true;
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (visited.has(id)) throw new NearClientError("EVIDENCE_MISMATCH");
    visited.add(id);
    const node = nodes.get(id);
    if (node === undefined) { complete = false; continue; }
    pending.push(...node.receiptIds);
    if (node.status.kind === "SUCCESS_RECEIPT_ID" && !node.receiptIds.includes(node.status.receiptId))
      throw new NearClientError("EVIDENCE_MISMATCH");
  }
  for (const id of nodes.keys()) if (!visited.has(id)) throw new NearClientError("EVIDENCE_MISMATCH");
  return complete;
}

function checkFinalStatus(data: TransactionObservation): void {
  if (data.status.kind === "UNKNOWN" || data.status.kind === "SUCCESS_RECEIPT_ID"
    || data.receiptOutcomes.some(outcome => outcome.status.kind === "UNKNOWN"))
    throw new NearClientError("EVIDENCE_INCOMPLETE");
  const nodes = new Map(data.receiptOutcomes.map(outcome => [outcome.id, outcome]));
  let selected = data.transactionOutcome;
  while (selected.status.kind === "SUCCESS_RECEIPT_ID") {
    const next = nodes.get(selected.status.receiptId);
    if (!next) throw new NearClientError("EVIDENCE_INCOMPLETE");
    selected = next;
  }
  if (selected.status.kind !== data.status.kind
    || (selected.status.kind === "SUCCESS_VALUE" && data.status.kind === "SUCCESS_VALUE"
      && selected.status.valueBase64 !== data.status.valueBase64))
    throw new NearClientError("EVIDENCE_MISMATCH");
}

export async function readTransaction(
  rpc: ReturnType<typeof createRpc>, ref: TransactionRef,
): Promise<{ data: TransactionObservation; block: BlockRef; assurance: "verified_final" | "pending_finality" }> {
  const params = { tx_hash: ref.transactionHash, sender_account_id: ref.signerAccountId, wait_until: "FINAL" };
  if (!TransactionRefSchema.safeParse(ref).success) throw new NearClientError("INVALID_ARGUMENT", false);
  let raw: unknown;
  try { raw = await rpc("tx_status", params); }
  catch (error) {
    // Same read, same provider, only the documented legacy method alias. No retry on ambiguity.
    if (!(error instanceof NearClientError) || error.code !== "RPC_METHOD_UNAVAILABLE") throw error;
    raw = await rpc("EXPERIMENTAL_tx_status", params);
  }
  const parsed = TransactionSchema.safeParse(raw);
  if (!parsed.success) {
    const partial = z.object({ final_execution_status: z.literal("NONE") }).safeParse(raw);
    if (partial.success) throw new NearClientError("TRANSACTION_UNKNOWN");
    throw new NearClientError("RPC_MALFORMED_RESPONSE");
  }
  const value = parsed.data;
  if (value.transaction.hash !== ref.transactionHash || value.transaction.signer_id !== ref.signerAccountId
    || value.transaction_outcome.id !== ref.transactionHash || value.transaction_outcome.executorAccountId !== ref.signerAccountId)
    throw new NearClientError("EVIDENCE_MISMATCH");
  const complete = reconcile(value.transaction_outcome, value.receipts_outcome);
  const data: TransactionObservation = {
    transactionHash: value.transaction.hash, signerAccountId: value.transaction.signer_id,
    receiverAccountId: value.transaction.receiver_id, executionFinality: value.final_execution_status,
    status: value.status, transactionOutcome: value.transaction_outcome, receiptOutcomes: value.receipts_outcome,
    outcomeGraphComplete: complete, blocks: [],
  };
  const getBlock = async (params: { block_id: string } | { finality: "final" }): Promise<BlockRef> => {
    const parsed = BlockSchema.safeParse(await rpc("block", params));
    if (!parsed.success) throw new NearClientError("RPC_MALFORMED_RESPONSE");
    if ("block_id" in params && parsed.data.hash !== params.block_id) throw new NearClientError("EVIDENCE_MISMATCH");
    return parsed.data;
  };
  if (value.final_execution_status !== "FINAL") {
    return { data, block: await getBlock({ block_id: data.transactionOutcome.blockHash }), assurance: "pending_finality" };
  }
  if (!complete) throw new NearClientError("EVIDENCE_INCOMPLETE");
  checkFinalStatus(data);
  const finalBlock = await getBlock({ finality: "final" });
  const hashes = new Set([data.transactionOutcome, ...data.receiptOutcomes].map(outcome => outcome.blockHash));
  if (hashes.size > 32) throw new NearClientError("EVIDENCE_INCOMPLETE");
  const blocks = new Map<string, BlockRef>();
  const heights = new Map<string, string>();
  for (const hash of hashes) {
    const block = hash === finalBlock.hash ? finalBlock : await getBlock({ block_id: hash });
    if (BigInt(block.height) > BigInt(finalBlock.height) || BigInt(block.timestampNs) > BigInt(finalBlock.timestampNs)
      || (block.height === finalBlock.height && block.hash !== finalBlock.hash)
      || (heights.has(block.height) && heights.get(block.height) !== block.hash))
      throw new NearClientError("EVIDENCE_MISMATCH");
    blocks.set(hash, block);
    heights.set(block.height, block.hash);
  }
  const nodes = new Map(data.receiptOutcomes.map(outcome => [outcome.id, outcome]));
  for (const outcome of [data.transactionOutcome, ...data.receiptOutcomes]) {
    const parent = blocks.get(outcome.blockHash)!;
    for (const id of outcome.receiptIds) {
      const child = blocks.get(nodes.get(id)!.blockHash)!;
      if (BigInt(child.height) < BigInt(parent.height) || BigInt(child.timestampNs) < BigInt(parent.timestampNs))
        throw new NearClientError("EVIDENCE_MISMATCH");
    }
  }
  data.blocks = [...blocks.values()];
  return { data, block: finalBlock, assurance: "verified_final" };
}
