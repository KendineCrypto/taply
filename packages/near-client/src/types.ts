import type { BlockRef, ChainObservation } from "@taply/shared";

export interface NearTestnetConfig {
  network: "near-testnet";
  rpcUrl: string;
  rpcProviderId: string;
  // null explicitly means there is no approved deployment to verify.
  contract: { accountId: string; expectedCodeHash: string } | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export const RPC_ERROR_CODES = [
  "INVALID_CONFIG", "INVALID_ARGUMENT", "RPC_UNAVAILABLE", "RPC_TIMEOUT",
  "RPC_RATE_LIMITED", "RPC_HTTP_ERROR", "RPC_MALFORMED_RESPONSE", "RPC_RESPONSE_TOO_LARGE",
  "RPC_METHOD_UNAVAILABLE", "RPC_ERROR", "NETWORK_MISMATCH", "NODE_SYNCING",
  "ACCOUNT_NOT_FOUND", "TRANSACTION_UNKNOWN", "RECEIPT_NOT_FOUND", "SHARD_UNAVAILABLE",
  "CONTRACT_NOT_CONFIGURED", "CONTRACT_CODE_MISMATCH", "EVIDENCE_MISMATCH", "EVIDENCE_INCOMPLETE",
] as const;
export type RpcErrorCode = typeof RPC_ERROR_CODES[number];
export interface RpcReadError {
  code: RpcErrorCode;
  messageKey: `nearClient.errors.${RpcErrorCode}`;
  retry: "NONE" | "READ_ONLY" | "WAIT_AND_RECONCILE";
  providerId: string;
}
export interface ReadResult<T> {
  observation: ChainObservation<T>;
  error: RpcReadError | null;
}
export interface NetworkSnapshot {
  network: "near-testnet";
  chainId: "testnet";
  genesisHash: string;
  providerId: string;
  nodeVersion: string;
}
export interface AccountSnapshot {
  accountId: string;
  amountYoctoNear: string;
  lockedYoctoNear: string;
  storageUsageBytes: string;
  codeHash: string;
}
export interface NativeBalance {
  accountId: string;
  assetId: "near:native";
  amountYoctoNear: string;
  lockedYoctoNear: string;
  // Account amount includes storage collateral; it is not a spending limit.
  storageUsageBytes: string;
}
export interface TransactionRef { transactionHash: string; signerAccountId: string }
export interface ReceiptRef extends TransactionRef { receiptId: string }
export type ExecutionStatus =
  | { kind: "SUCCESS_VALUE"; valueBase64: string }
  | { kind: "SUCCESS_RECEIPT_ID"; receiptId: string }
  | { kind: "FAILURE"; detailJson: string }
  | { kind: "UNKNOWN" };
export interface ExecutionOutcome {
  id: string;
  blockHash: string;
  executorAccountId: string;
  receiptIds: readonly string[];
  status: ExecutionStatus;
  logs: readonly string[];
  gasBurnt: string;
  tokensBurntYoctoNear: string;
}
export type ExecutionFinality = "NONE" | "INCLUDED" | "EXECUTED_OPTIMISTIC" | "INCLUDED_FINAL" | "EXECUTED" | "FINAL";
export interface TransactionObservation {
  transactionHash: string;
  signerAccountId: string;
  receiverAccountId: string;
  executionFinality: ExecutionFinality;
  status: ExecutionStatus;
  transactionOutcome: ExecutionOutcome;
  receiptOutcomes: readonly ExecutionOutcome[];
  outcomeGraphComplete: boolean;
  // Blocks are populated only after FINAL and complete outcome reconciliation.
  blocks: readonly BlockRef[];
}
export interface ReceiptObservation {
  transactionHash: string;
  signerAccountId: string;
  executionFinality: ExecutionFinality;
  outcome: ExecutionOutcome;
  block: BlockRef | null;
}
export interface NearTestnetClient {
  checkNetwork(): Promise<ReadResult<NetworkSnapshot>>;
  readAccount(accountId: string): Promise<ReadResult<AccountSnapshot>>;
  readNativeBalance(accountId: string): Promise<ReadResult<NativeBalance>>;
  checkContract(): Promise<ReadResult<AccountSnapshot>>;
  observeTransaction(ref: TransactionRef): Promise<ReadResult<TransactionObservation>>;
  observeReceipt(ref: ReceiptRef): Promise<ReadResult<ReceiptObservation>>;
}
