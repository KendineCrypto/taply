import { z } from "zod";
import { PublicKey, Transaction, actions, baseDecode, baseEncode, base64Encode, base64Decode, createTransaction, encodeTransaction } from "near-api-js";
import { canonicalJson, ContractMethodArgs, U64_MAX } from "@taply/shared";
import { buildClient } from "./client.js";
import { contractConfigProblems, prepareCreateRequest, preparePayInstantNative, prepareRetryNativeTransfer, prepareCancelUnfunded } from "./contract.js";
import type { PreparedContractCall } from "./contract.js";
import type { NearTestnetConfig, NearTestnetClient, ReadResult } from "./types.js";
import type { Fetch } from "./rpc.js";
import { parseConfig } from "./rpc.js";
import { createWalletChain, ed25519PublicKeyFromHex } from "./wallet-chain.js";
import type { WalletChain } from "./wallet-chain.js";
import { EncryptedTestnetVault, signVaultTransaction } from "./wallet-vault.js";
import type { VaultStorage } from "./wallet-vault.js";
import { WalletAttemptJournal } from "./wallet-journal.js";
import { OneShotWalletProvider } from "./wallet-sdk-rpc.js";
import { WalletEngineError, prepareNativeNearTransfer, spendingBudget, WALLET_MAX_CALL_GAS } from "./wallet-transfer.js";
import type { WalletBalanceSnapshot } from "./wallet-transfer.js";

export const APPROVED_PAYMENT_CODE_HASH = "BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B";
export const WALLET_REVIEW_TTL_MS = 60_000;
export interface WalletTransactionReview {
  readonly id: string; readonly network: "near-testnet"; readonly kind: "native_transfer" | "contract_call";
  readonly signerAccountId: string; readonly publicKey: string; readonly receiverId: string;
  readonly depositYocto: string; readonly gas: string; readonly methodName: string | null; readonly argsJson: string | null;
  readonly nonce: string; readonly blockHash: string; readonly storageReserveYocto: string;
  readonly gasReserveYocto: string; readonly availableYocto: string; readonly expiresAtMs: number;
}
export type WalletSubmission =
  | { readonly kind: "final"; readonly transactionHash: string; readonly outcome: "SUCCEEDED" | "FAILED"; readonly settlementProof: "NOT_VERIFIED" }
  | { readonly kind: "unknown"; readonly transactionHash: string | null };
export interface WalletBackendPolicy {
  signingPermitted(): boolean;
  contractCallsPermitted(): boolean;
  /** Mandatory browser Web Lock. Tests supply an isolated deterministic lock. */
  withExclusiveLock<T>(task: () => Promise<T>): Promise<T>;
}
type Plan = { review: WalletTransactionReview; bytes: Uint8Array<ArrayBuffer>; snapshot: WalletBalanceSnapshot; call: PreparedContractCall | null };
type Reads = Pick<NearTestnetClient, "readContractConfig" | "quoteCreateRequest" | "readPaymentRequest" | "observeTransaction">;
function fresh<T>(result: ReadResult<T>): { data: T; timestampNs: string } {
  const o = result.observation;
  if (result.error || o.source !== "rpc" || o.assurance !== "verified_final" || o.stale || !o.rpcAvailable || o.data === null || !o.observedBlock)
    throw new WalletEngineError("RPC_UNAVAILABLE");
  return { data: o.data, timestampNs: o.observedBlock.timestampNs };
}
const TxResponse = z.object({ final_execution_status: z.literal("FINAL"), transaction: z.object({
  hash: z.string(), signer_id: z.string(), receiver_id: z.string(), public_key: z.string(), nonce: z.union([z.number().int().safe(), z.bigint().nonnegative()]).transform(String), actions: z.array(z.unknown()).length(1),
}), status: z.unknown() });

/** Independent SDK backend. Default production caller binds BOTH approvals to
 * hard-disabled gates. No keys, signing state or policy is loaded from storage.
 * Network dependencies are injectable for isolated offline tests only.
 */
export function createReviewedWalletBackend(input: {
  config: NearTestnetConfig; vault: EncryptedTestnetVault; storage: VaultStorage; policy: WalletBackendPolicy;
  crypto?: Crypto; now?: () => number; fetcher?: Fetch; chain?: WalletChain; reader?: Reads;
}) {
  const config = parseConfig(input.config);
  const crypto = input.crypto ?? globalThis.crypto;
  const now = input.now ?? Date.now;
  const fetcher = input.fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const chain = input.chain ?? createWalletChain(config, fetcher);
  const reader = input.reader ?? buildClient(config, fetcher, false, () => new Date());
  const journal = new WalletAttemptJournal(input.storage);
  const plans = new Map<string, Plan>();
  let busy = false;
  let broadcastHash: string | null = null;
  let broadcastLease: (() => void) | null = null;
  let broadcastExpiresAt = 0;
  let broadcastIsContract = false;
  const provider = new OneShotWalletProvider(config, fetcher, () => {
    if (!input.policy.signingPermitted()) throw new WalletEngineError("SIGNING_DISABLED");
    if (broadcastIsContract && !input.policy.contractCallsPermitted()) throw new WalletEngineError("SIGNING_DISABLED");
    if (!broadcastLease || now() >= broadcastExpiresAt) throw new WalletEngineError("REVIEW_EXPIRED");
    broadcastLease();
    if (!input.vault.unlocked) throw new WalletEngineError("LOCKED");
    const attempt = journal.read();
    if (!broadcastHash || attempt?.transactionHash !== broadcastHash || attempt.phase !== "SUBMITTED" || !attempt.unsignedTransaction)
      throw new WalletEngineError("OUTCOME_UNRESOLVED");
  });
  const identity = () => {
    const id = input.vault.getIdentity();
    if (!id) throw new WalletEngineError("ACCOUNT_NOT_PROVISIONED");
    return id;
  };
  const snapshot = async () => {
    const id = identity();
    const value = await chain.snapshot(id.accountId, ed25519PublicKeyFromHex(id.publicKeyHex));
    if (!value) throw new WalletEngineError("ACCOUNT_NOT_PROVISIONED");
    const age = BigInt(now()) * 1_000_000n - BigInt(value.blockTimestampNs);
    if (value.network !== "near-testnet" || value.accountId !== id.accountId || value.publicKey !== ed25519PublicKeyFromHex(id.publicKeyHex) ||
      age < -10_000_000_000n || age > 90_000_000_000n || BigInt(value.nonce) >= U64_MAX)
      throw new WalletEngineError("INVALID_SNAPSHOT");
    const previous = journal.read();
    if (previous?.accountId === id.accountId && previous.unsignedTransaction && previous.transactionHash &&
      (previous.phase === "FINAL_SUCCEEDED" || previous.phase === "FINAL_FAILED")) {
      const oldBytes = base64Decode(previous.unsignedTransaction);
      const oldTx = Transaction.decode(oldBytes);
      if (await hashOf(oldBytes) !== previous.transactionHash || oldTx.signerId !== id.accountId || BigInt(value.nonce) < oldTx.nonce)
        throw new WalletEngineError("REVIEW_EXPIRED");
    }
    return value;
  };
  const checkedPayment = async (candidate: PreparedContractCall): Promise<PreparedContractCall> => {
    if (!["create_request", "pay_instant_native", "retry_native_transfer", "cancel_unfunded"].includes(candidate.methodName))
      throw new WalletEngineError("CALL_NOT_ALLOWED");
    const contract = config.contract;
    if (!contract || contract.expectedCodeHash !== APPROVED_PAYMENT_CODE_HASH || candidate.receiverId !== contract.accountId)
      throw new WalletEngineError("CALL_NOT_ALLOWED");
    const { data: deployed } = fresh(await reader.readContractConfig());
    if (contractConfigProblems(deployed, contract.accountId).length) throw new WalletEngineError("CALL_NOT_ALLOWED");
    const signerAccountId = identity().accountId;
    const base = { contractId: contract.accountId, config: deployed, signerAccountId };
    let prepared: PreparedContractCall;
    if (candidate.methodName === "create_request") {
      const { terms } = ContractMethodArgs.create_request.parse(candidate.args);
      const { data: quote } = fresh(await reader.quoteCreateRequest(terms));
      prepared = prepareCreateRequest({ ...base, terms, quote });
    } else {
      const { id } = ContractMethodArgs[candidate.methodName].parse(candidate.args);
      const requestRead = fresh(await reader.readPaymentRequest(id));
      const request = requestRead.data.request;
      if (!request) throw new WalletEngineError("CALL_NOT_ALLOWED");
      if (candidate.methodName === "pay_instant_native") prepared = preparePayInstantNative({ ...base, request, observedAtNs: requestRead.timestampNs });
      else if (candidate.methodName === "retry_native_transfer") prepared = prepareRetryNativeTransfer({ ...base, request });
      else prepared = prepareCancelUnfunded({ ...base, request });
    }
    if (canonicalJson(candidate) !== canonicalJson(prepared) || BigInt(prepared.gas) > WALLET_MAX_CALL_GAS)
      throw new WalletEngineError("CALL_NOT_ALLOWED");
    return JSON.parse(canonicalJson(prepared)) as PreparedContractCall;
  };
  const prepare = async (receiverId: string, amountNear: string | null, candidate: PreparedContractCall | null) => {
    journal.assertClear();
    for (const [id, plan] of plans) if (now() >= plan.review.expiresAtMs) plans.delete(id);
    if (plans.size >= 20) throw new WalletEngineError("OUTCOME_UNRESOLVED");
    const state = await snapshot();
    const call = candidate === null ? null : await checkedPayment(candidate);
    const native = call === null ? prepareNativeNearTransfer(state, receiverId, amountNear ?? "") : null;
    await chain.receiverExists(receiverId, state.blockHash);
    const depositYocto = call?.depositYocto ?? native?.depositYocto ?? "";
    const budget = spendingBudget(state, depositYocto);
    const argsJson = call === null ? null : canonicalJson(call.args);
    if (argsJson !== null && new TextEncoder().encode(argsJson).byteLength > 8192) throw new WalletEngineError("CALL_NOT_ALLOWED");
    const tx = createTransaction(state.accountId, PublicKey.fromString(state.publicKey), receiverId, BigInt(state.nonce) + 1n,
      [call === null ? actions.transfer(BigInt(depositYocto)) : actions.functionCall(call.methodName, new TextEncoder().encode(argsJson ?? "{}"), BigInt(call.gas), BigInt(depositYocto))], baseDecode(state.blockHash));
    const bytes = new Uint8Array(encodeTransaction(tx));
    const review: WalletTransactionReview = Object.freeze({ id: crypto.randomUUID(), network: "near-testnet", kind: call === null ? "native_transfer" : "contract_call",
      signerAccountId: state.accountId, publicKey: state.publicKey, receiverId, depositYocto, gas: call?.gas ?? "0", methodName: call?.methodName ?? null,
      argsJson, nonce: tx.nonce.toString(), blockHash: state.blockHash, ...budget, expiresAtMs: now() + WALLET_REVIEW_TTL_MS });
    plans.set(review.id, { review, bytes, snapshot: state, call });
    return review;
  };
  const hashOf = async (bytes: Uint8Array) => baseEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
  const reconcile = async (): Promise<WalletSubmission> => {
    const attempt = journal.read();
    if (!attempt?.transactionHash || !attempt.unsignedTransaction) return { kind: "unknown", transactionHash: attempt?.transactionHash ?? null };
    try {
      await chain.checkNetwork();
      const bytes = base64Decode(attempt.unsignedTransaction);
      const tx = Transaction.decode(bytes);
      if (await hashOf(bytes) !== attempt.transactionHash || tx.signerId !== attempt.accountId) throw new WalletEngineError("OUTCOME_UNRESOLVED");
      const raw = TxResponse.parse(await provider.viewTransactionStatusWithReceipts({ txHash: attempt.transactionHash, accountId: attempt.accountId, waitUntil: "FINAL" }));
      const t = raw.transaction;
      const action = tx.actions[0];
      const expectedAction = action?.transfer ? { Transfer: { deposit: action.transfer.deposit.toString() } } : action?.functionCall ? {
        FunctionCall: { method_name: action.functionCall.methodName, args: base64Encode(new Uint8Array(action.functionCall.args)), gas: Number(action.functionCall.gas), deposit: action.functionCall.deposit.toString() },
      } : null;
      if (t.hash !== attempt.transactionHash || t.signer_id !== tx.signerId || t.receiver_id !== tx.receiverId ||
        t.public_key !== tx.publicKey.toString() || BigInt(t.nonce) !== tx.nonce || expectedAction === null || canonicalJson(t.actions[0]) !== canonicalJson(expectedAction))
        throw new WalletEngineError("OUTCOME_UNRESOLVED");
      // Independent existing reader checks FINAL, the complete rooted outcome
      // graph and every receipt block. A hash or deposit alone never settles.
      const observation = fresh(await reader.observeTransaction({ transactionHash: attempt.transactionHash, signerAccountId: attempt.accountId })).data;
      if (observation.executionFinality !== "FINAL" || !observation.outcomeGraphComplete ||
        observation.transactionHash !== attempt.transactionHash || observation.signerAccountId !== tx.signerId || observation.receiverAccountId !== tx.receiverId)
        throw new WalletEngineError("OUTCOME_UNRESOLVED");
      const succeeded = observation.status.kind === "SUCCESS_VALUE";
      if (!succeeded && observation.status.kind !== "FAILURE") throw new WalletEngineError("OUTCOME_UNRESOLVED");
      if (succeeded && canonicalJson(raw.status) !== canonicalJson({ SuccessValue: observation.status.kind === "SUCCESS_VALUE" ? observation.status.valueBase64 : "" }))
        throw new WalletEngineError("OUTCOME_UNRESOLVED");
      if (!succeeded && (typeof raw.status !== "object" || raw.status === null || !Object.hasOwn(raw.status, "Failure")))
        throw new WalletEngineError("OUTCOME_UNRESOLVED");
      const root = observation.transactionOutcome;
      const firstId = root.status.kind === "SUCCESS_RECEIPT_ID" ? root.status.receiptId : null;
      const first = observation.receiptOutcomes.find((o) => o.id === firstId);
      if (succeeded && (!first || first.executorAccountId !== tx.receiverId ||
        (action?.transfer && (first.status.kind !== "SUCCESS_VALUE" || first.status.valueBase64 !== ""))))
        throw new WalletEngineError("OUTCOME_UNRESOLVED");
      const phase = succeeded ? "FINAL_SUCCEEDED" : "FINAL_FAILED";
      if (attempt.phase === "SUBMITTED" || attempt.phase === "UNKNOWN") journal.update(attempt.reviewId, phase);
      else if (attempt.phase !== phase) throw new WalletEngineError("OUTCOME_UNRESOLVED");
      return { kind: "final", transactionHash: attempt.transactionHash, outcome: succeeded ? "SUCCEEDED" : "FAILED", settlementProof: "NOT_VERIFIED" };
    } catch { return { kind: "unknown", transactionHash: attempt.transactionHash }; }
  };
  return Object.freeze({
    prepareTransfer: (receiverId: string, amountNear: string) => prepare(receiverId, amountNear, null),
    prepareContractCall: (call: PreparedContractCall) => prepare(call.receiverId, null, JSON.parse(canonicalJson(call)) as PreparedContractCall),
    reconcile,
    async submit(reviewId: string, confirm: (review: WalletTransactionReview) => Promise<boolean>): Promise<WalletSubmission> {
      if (!input.policy.signingPermitted()) throw new WalletEngineError("SIGNING_DISABLED");
      if (busy) throw new WalletEngineError("OUTCOME_UNRESOLVED");
      const plan = plans.get(reviewId); plans.delete(reviewId);
      if (!plan) throw new WalletEngineError("REVIEW_EXPIRED");
      busy = true;
      try { return await input.policy.withExclusiveLock(async () => {
        journal.assertClear();
        if (!input.vault.unlocked) throw new WalletEngineError("LOCKED");
        if (now() >= plan.review.expiresAtMs) throw new WalletEngineError("REVIEW_EXPIRED");
        if (plan.call && !input.policy.contractCallsPermitted()) throw new WalletEngineError("SIGNING_DISABLED");
        if (await confirm(plan.review) !== true) throw new WalletEngineError("REVIEW_REJECTED");
        if (!input.policy.signingPermitted() || (plan.call && !input.policy.contractCallsPermitted())) throw new WalletEngineError("SIGNING_DISABLED");
        if (!input.vault.unlocked) throw new WalletEngineError("LOCKED");
        if (now() >= plan.review.expiresAtMs) throw new WalletEngineError("REVIEW_EXPIRED");
        const current = await snapshot();
        const budget = spendingBudget(current, plan.review.depositYocto);
        if (current.nonce !== plan.snapshot.nonce || current.publicKey !== plan.snapshot.publicKey || current.accountId !== plan.snapshot.accountId ||
          BigInt(current.blockHeight) < BigInt(plan.snapshot.blockHeight) ||
          (current.blockHeight === plan.snapshot.blockHeight && current.blockHash !== plan.snapshot.blockHash) ||
          BigInt(current.blockTimestampNs) < BigInt(plan.snapshot.blockTimestampNs) ||
          BigInt(budget.gasReserveYocto) > BigInt(plan.review.gasReserveYocto) ||
          BigInt(budget.storageReserveYocto) > BigInt(plan.review.storageReserveYocto)) throw new WalletEngineError("REVIEW_EXPIRED");
        await chain.receiverExists(plan.review.receiverId, current.blockHash);
        if (plan.call) await checkedPayment(plan.call);
        journal.begin(current.accountId, reviewId);
        let hash: string | null = null;
        try {
          if (!input.policy.signingPermitted() || now() >= plan.review.expiresAtMs) throw new WalletEngineError("SIGNING_DISABLED");
          const signed = await signVaultTransaction(input.vault, Transaction.decode(plan.bytes));
          hash = await hashOf(plan.bytes);
          if (hash !== baseEncode(signed.txHash)) throw new WalletEngineError("SIGNATURE_INVALID");
          signed.assertActive();
          if (!input.vault.unlocked || now() >= plan.review.expiresAtMs) throw new WalletEngineError("LOCKED");
          // Must be durable BEFORE invoking the SDK transport, even on timeout.
          journal.update(reviewId, "SUBMITTED", hash, base64Encode(plan.bytes));
          broadcastHash = hash;
          broadcastLease = signed.assertActive; broadcastExpiresAt = plan.review.expiresAtMs; broadcastIsContract = plan.call !== null;
          const response = await provider.sendTransactionUntil(signed.signedTransaction, "FINAL");
          if (TxResponse.parse(response).transaction.hash !== hash) throw new WalletEngineError("OUTCOME_UNRESOLVED");
        } catch {
          const attempt = journal.read();
          if (attempt?.phase === "RESERVED") journal.update(reviewId, "NOT_SENT");
          else if (attempt?.phase === "SUBMITTED") journal.update(reviewId, "UNKNOWN");
          return { kind: "unknown", transactionHash: attempt?.transactionHash ?? null };
        } finally { broadcastHash = null; broadcastLease = null; broadcastExpiresAt = 0; broadcastIsContract = false; }
        return reconcile();
      }); } finally { busy = false; }
    },
  });
}
export type ReviewedWalletBackend = ReturnType<typeof createReviewedWalletBackend>;
