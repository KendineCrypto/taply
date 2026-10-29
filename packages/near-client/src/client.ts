import { z } from "zod";
import { AccountIdSchema, type BlockRef, type ChainObservation } from "@taply/shared";
import { AccountSchema, BlockSchema, HashSchema, ReceiptRefSchema, TransactionRefSchema } from "./validation.js";
import { readTransaction } from "./transactions.js";
import { createRpc, NearClientError, parseConfig, publicError, TESTNET_GENESIS_HASH, type Fetch } from "./rpc.js";
import type { AccountSnapshot, NearTestnetClient, NearTestnetConfig, NetworkSnapshot, ReadResult, ReceiptRef, TransactionRef } from "./types.js";

const StatusSchema = z.object({
  chain_id: z.string(), genesis_hash: HashSchema,
  version: z.object({ version: z.string().min(1).max(128) }),
  sync_info: z.object({ syncing: z.boolean() }),
});
type ObservationValue<T> = { data: T; block: BlockRef; assurance?: "verified_final" | "pending_finality" };

export function buildClient(input: NearTestnetConfig, fetcher: Fetch, mock: boolean, now: () => Date): NearTestnetClient {
  const config = parseConfig(input);
  const rpc = createRpc(config, fetcher);
  const schema = <T>(validator: z.ZodType<T>, value: unknown): T => {
    const result = validator.safeParse(value);
    if (!result.success) throw new NearClientError("RPC_MALFORMED_RESPONSE");
    return result.data;
  };
  const network = async (): Promise<NetworkSnapshot> => {
    const status = schema(StatusSchema, await rpc("status", []));
    if (status.chain_id !== "testnet" || status.genesis_hash !== TESTNET_GENESIS_HASH)
      throw new NearClientError("NETWORK_MISMATCH");
    if (status.sync_info.syncing) throw new NearClientError("NODE_SYNCING");
    return { network: "near-testnet", chainId: "testnet", genesisHash: status.genesis_hash,
      providerId: config.rpcProviderId, nodeVersion: status.version.version };
  };
  const finalBlock = async () => schema(BlockSchema, await rpc("block", { finality: "final" }));
  const run = async <T>(task: () => Promise<ObservationValue<T>>): Promise<ReadResult<T>> => {
    try {
      const { data, block, assurance = "verified_final" } = await task();
      return { observation: { source: mock ? "mock" : "rpc", assurance: mock ? "unverified" : assurance,
        data, observedBlock: mock ? null : block, checkedAt: now().toISOString(), stale: false, rpcAvailable: !mock }, error: null };
    } catch (cause) {
      const error = cause instanceof NearClientError ? cause : new NearClientError("RPC_MALFORMED_RESPONSE");
      const mismatch = ["NETWORK_MISMATCH", "CONTRACT_CODE_MISMATCH", "EVIDENCE_MISMATCH"].includes(error.code);
      const observation: ChainObservation<T> = {
        source: mock ? "mock" : "rpc", assurance: mock ? "unverified" : mismatch ? "mismatch" : "unknown",
        data: null, observedBlock: null, checkedAt: now().toISOString(), stale: false, rpcAvailable: !mock && error.rpcAvailable,
      };
      return { observation, error: publicError(error, config.rpcProviderId) };
    }
  };
  const account = async (accountId: string): Promise<ObservationValue<AccountSnapshot>> => {
    if (!AccountIdSchema.safeParse(accountId).success) throw new NearClientError("INVALID_ARGUMENT", false);
    await network();
    const block = await finalBlock();
    const value = schema(AccountSchema, await rpc("query", { request_type: "view_account", account_id: accountId, block_id: block.hash }));
    if (value.block_hash !== block.hash || value.block_height !== block.height) throw new NearClientError("EVIDENCE_MISMATCH");
    return { block, data: { accountId, amountYoctoNear: value.amount, lockedYoctoNear: value.locked,
      storageUsageBytes: value.storage_usage, codeHash: value.code_hash } };
  };
  const transaction = async (ref: TransactionRef) => {
    const parsed = TransactionRefSchema.safeParse(ref);
    if (!parsed.success) throw new NearClientError("INVALID_ARGUMENT", false);
    await network();
    return readTransaction(rpc, parsed.data);
  };
  return Object.freeze({
    checkNetwork: () => run(async () => ({ data: await network(), block: await finalBlock() })),
    readAccount: (accountId: string) => run(() => account(accountId)),
    readNativeBalance: (accountId: string) => run(async () => {
      const { data, block } = await account(accountId);
      return { block, data: { accountId, assetId: "near:native" as const, amountYoctoNear: data.amountYoctoNear,
        lockedYoctoNear: data.lockedYoctoNear, storageUsageBytes: data.storageUsageBytes } };
    }),
    checkContract: () => run(async () => {
      if (config.contract === null) throw new NearClientError("CONTRACT_NOT_CONFIGURED", false);
      const result = await account(config.contract.accountId);
      if (result.data.codeHash !== config.contract.expectedCodeHash) throw new NearClientError("CONTRACT_CODE_MISMATCH");
      return result;
    }),
    observeTransaction: (ref: TransactionRef) => run(() => transaction(ref)),
    observeReceipt: (ref: ReceiptRef) => run(async () => {
      const parsed = ReceiptRefSchema.safeParse(ref);
      if (!parsed.success) throw new NearClientError("INVALID_ARGUMENT", false);
      const { transactionHash, signerAccountId, receiptId } = parsed.data;
      const result = await transaction({ transactionHash, signerAccountId });
      const outcome = result.data.receiptOutcomes.find(outcome => outcome.id === receiptId);
      if (outcome === undefined) throw new NearClientError(
        result.data.executionFinality === "FINAL" ? "RECEIPT_NOT_FOUND" : "EVIDENCE_INCOMPLETE",
      );
      const block = result.data.blocks.find(block => block.hash === outcome.blockHash) ?? null;
      return { block: result.block, assurance: result.assurance, data: {
        transactionHash, signerAccountId, executionFinality: result.data.executionFinality, outcome, block,
      } };
    }),
  });
}
