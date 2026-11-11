import { z } from "zod";
import { PublicKey, Transaction, actions, baseDecode, baseEncode, base64Encode, base64Decode, createTransaction, encodeTransaction } from "near-api-js";
import { canonicalJson, ContractMethodArgs, U64_MAX } from "@taply/shared";
import { buildClient } from "./client.js";
import { contractConfigProblems, prepareCreateRequest, preparePayInstantNative, prepareRetryNativeTransfer, prepareCancelUnfunded } from "./contract.js";
import type { PreparedContractCall } from "./contract.js";
import {
  createProtectedReader, prepareCancelProtected, prepareCreateProtectedRequest, prepareFundProtectedNative,
  prepareReleaseProtected, prepareRetryProtectedTransfer, protectedConfigProblems,
} from "./protected.js";
import type { PreparedProtectedCall, ProtectedReader } from "./protected.js";
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
import { TESTNET_SWAP_ROUTES } from "./ref-swap.js";

export const APPROVED_PAYMENT_CODE_HASH = "BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B";
export const WALLET_REVIEW_TTL_MS = 60_000;
export interface WalletTransactionReview {
  readonly id: string; readonly network: "near-testnet"; readonly kind: "native_transfer" | "contract_call" | "token_swap";
  readonly signerAccountId: string; readonly publicKey: string; readonly receiverId: string;
  readonly depositYocto: string; readonly gas: string; readonly methodName: string | null; readonly argsJson: string | null;
  readonly nonce: string; readonly blockHash: string; readonly storageReserveYocto: string;
  readonly gasReserveYocto: string; readonly availableYocto: string; readonly expiresAtMs: number;
  /** token_swap only: every function call of the transaction, canonical JSON. */
  readonly actionsJson?: string;
}
/** One function call of a token-swap transaction (ref-swap.ts builders). */
export interface WalletFunctionCall { readonly methodName: string; readonly args: Record<string, unknown>; readonly gas: string; readonly depositYocto: string }
/** A Ref/Rhea Testnet swap transaction for a curated route (TESTNET_SWAP_ROUTES). */
export interface PreparedWalletSwap { readonly receiverId: string; readonly actions: readonly WalletFunctionCall[] }

const REF_EXCHANGE = "ref-finance-101.testnet";
const WRAPPED_NEAR = "wrap.testnet";
const MAX_STORAGE_DEPOSIT = 50_000_000_000_000_000_000_000n; // 0.05 NEAR
const MAX_SWAP_GAS = 300_000_000_000_000n;
const U128_TEXT = /^[1-9][0-9]{0,38}$/;
const sameJson = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
/**
 * Exact-shape check for swap transactions: only the curated routes, only the
 * register / buy (wrap + swap) / sell (swap + native unwrap) shapes ref-swap.ts
 * builds, the signer as the only account in arguments, bounded deposits and gas.
 * Anything else, including an arbitrary token or pool, is CALL_NOT_ALLOWED.
 */
export function checkedSwapTransaction(candidate: PreparedWalletSwap, signerAccountId: string): PreparedWalletSwap {
  const refuse = (): never => { throw new WalletEngineError("CALL_NOT_ALLOWED"); };
  const parsed = JSON.parse(canonicalJson(candidate)) as PreparedWalletSwap;
  const acts = parsed.actions;
  if (!Array.isArray(acts) || acts.length < 1 || acts.length > 3) refuse();
  for (const a of acts) {
    if (typeof a.methodName !== "string" || typeof a.args !== "object" || a.args === null || !U128_TEXT.test(a.gas) || BigInt(a.gas) > MAX_SWAP_GAS ||
      !(U128_TEXT.test(a.depositYocto))) refuse();
  }
  const registration = (a: WalletFunctionCall) => a.methodName === "storage_deposit" &&
    sameJson(a.args, { account_id: signerAccountId, registration_only: true }) && BigInt(a.depositYocto) <= MAX_STORAGE_DEPOSIT;
  const swapMsg = (msg: unknown, tokenIn: string, tokenOut: string, amount: string, unwrap: boolean) => {
    if (typeof msg !== "string") return false;
    let m: unknown; try { m = JSON.parse(msg); } catch { return false; }
    const route = TESTNET_SWAP_ROUTES.find((r) => r.token === (tokenIn === WRAPPED_NEAR ? tokenOut : tokenIn));
    if (!route || typeof m !== "object" || m === null) return false;
    const action = (m as { actions?: unknown[] }).actions?.[0] as Record<string, unknown> | undefined;
    if (!action || typeof action.min_amount_out !== "string" || !U128_TEXT.test(action.min_amount_out)) return false;
    const expected = { force: 0, actions: [{ pool_id: route.poolId, token_in: tokenIn, token_out: tokenOut, amount_in: amount, min_amount_out: action.min_amount_out }],
      ...(unwrap ? { skip_unwrap_near: false } : {}) };
    return sameJson(m, expected);
  };
  const route = TESTNET_SWAP_ROUTES.find((r) => r.token === parsed.receiverId);
  if (route) {
    if (acts.length !== 1) refuse();
    const a = acts[0]!;
    if (registration(a)) return parsed;
    const args = a.args as { receiver_id?: unknown; amount?: unknown; msg?: unknown };
    if (a.methodName === "ft_transfer_call" && a.depositYocto === "1" && Object.keys(args).sort().join() === "amount,msg,receiver_id" &&
      args.receiver_id === REF_EXCHANGE && typeof args.amount === "string" && U128_TEXT.test(args.amount) &&
      swapMsg(args.msg, route.token, WRAPPED_NEAR, args.amount, true)) return parsed;
    return refuse();
  }
  if (parsed.receiverId !== WRAPPED_NEAR) refuse();
  const rest = registration(acts[0]!) ? acts.slice(1) : acts;
  if (rest.length !== 2) refuse();
  const [wrap, swap] = rest as [WalletFunctionCall, WalletFunctionCall];
  const args = swap.args as { receiver_id?: unknown; amount?: unknown; msg?: unknown };
  let tokenOut: unknown = null;
  try { tokenOut = (JSON.parse(String(args.msg)) as { actions?: Array<{ token_out?: unknown }> }).actions?.[0]?.token_out; } catch { refuse(); }
  if (wrap.methodName !== "near_deposit" || !sameJson(wrap.args, {}) || swap.methodName !== "ft_transfer_call" || swap.depositYocto !== "1" ||
    Object.keys(args).sort().join() !== "amount,msg,receiver_id" || args.receiver_id !== REF_EXCHANGE || args.amount !== wrap.depositYocto ||
    typeof tokenOut !== "string" || !swapMsg(args.msg, WRAPPED_NEAR, tokenOut, wrap.depositYocto, false)) refuse();
  return parsed;
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
type WalletContractCall = PreparedContractCall | PreparedProtectedCall;
type Plan = { review: WalletTransactionReview; bytes: Uint8Array<ArrayBuffer>; snapshot: WalletBalanceSnapshot; call: WalletContractCall | null; swap: PreparedWalletSwap | null };
/**
 * Protected Pay escrow candidate the wallet may sign for (owner decision
 * 2026-11-11, Testnet only, UNREVIEWED contract, no independent review).
 * Separate from `config.contract`; the pilot can never be named here
 * (createProtectedReader refuses it).
 */
export interface WalletProtectedContract { readonly accountId: string; readonly expectedCodeHash: string }
const PROTECTED_METHODS = ["create_request", "fund_protected_native", "cancel_protected", "release_protected", "retry_native_transfer"] as const;
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
const TxResponseAnyActions = z.object({ final_execution_status: z.literal("FINAL"), transaction: z.object({
  hash: z.string(), signer_id: z.string(), receiver_id: z.string(), public_key: z.string(), nonce: z.union([z.number().int().safe(), z.bigint().nonnegative()]).transform(String), actions: z.array(z.unknown()).min(1).max(3),
}), status: z.unknown() });

/** Independent SDK backend. The caller binds BOTH approvals to its policy
 * (Taply Wallet: enabled on NEAR Testnet by owner decision 2026-11-09, no
 * independent security review). No keys, signing state or policy is loaded from storage.
 * Network dependencies are injectable for isolated offline tests only.
 */
export function createReviewedWalletBackend(input: {
  config: NearTestnetConfig; vault: EncryptedTestnetVault; storage: VaultStorage; policy: WalletBackendPolicy;
  crypto?: Crypto; now?: () => number; fetcher?: Fetch; chain?: WalletChain; reader?: Reads;
  protectedContract?: WalletProtectedContract | null; protectedReader?: ProtectedReader;
}) {
  const config = parseConfig(input.config);
  const crypto = input.crypto ?? globalThis.crypto;
  const now = input.now ?? Date.now;
  const fetcher = input.fetcher ?? ((url, init) => globalThis.fetch(url, init));
  const chain = input.chain ?? createWalletChain(config, fetcher);
  const reader = input.reader ?? buildClient(config, fetcher, false, () => new Date());
  const protectedContract = input.protectedContract ?? null;
  const protectedReader = protectedContract === null ? null
    : input.protectedReader ?? createProtectedReader({ ...config, contract: protectedContract }, fetcher);
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
  /**
   * Protected Pay calls: same rule as payments. The call is REBUILT from final,
   * code-hash-anchored reads of the configured escrow candidate (config, quote or
   * request) with the protected.ts builders, and signed only if the candidate is
   * byte-for-byte that rebuilt call. Native NEAR only; token requests are refused.
   */
  const checkedProtected = async (candidate: PreparedProtectedCall): Promise<PreparedProtectedCall> => {
    if (protectedContract === null || protectedReader === null || candidate.receiverId !== protectedContract.accountId ||
      !(PROTECTED_METHODS as readonly string[]).includes(candidate.methodName)) throw new WalletEngineError("CALL_NOT_ALLOWED");
    const { data: deployed } = fresh(await protectedReader.readConfig());
    // The candidate is unreviewed by definition; every OTHER problem refuses.
    if (protectedConfigProblems(deployed, protectedContract.accountId).some((p) => p !== "UNREVIEWED_CANDIDATE"))
      throw new WalletEngineError("CALL_NOT_ALLOWED");
    const signerAccountId = identity().accountId;
    const base = { contractId: protectedContract.accountId, config: deployed };
    let prepared: PreparedProtectedCall;
    try {
      if (candidate.methodName === "create_request") {
        const { terms } = ContractMethodArgs.create_request.parse(candidate.args);
        if (terms.assetId !== "near:native") throw new WalletEngineError("CALL_NOT_ALLOWED");
        const { data: quote } = fresh(await protectedReader.client.quoteCreateRequest(terms));
        prepared = prepareCreateProtectedRequest({ ...base, terms, quote, signerAccountId });
      } else {
        const { id } = ContractMethodArgs[candidate.methodName].parse(candidate.args);
        const requestRead = fresh(await protectedReader.client.readPaymentRequest(id));
        const request = requestRead.data.request;
        if (!request || request.terms.assetId !== "near:native") throw new WalletEngineError("CALL_NOT_ALLOWED");
        const observedAtNs = requestRead.timestampNs;
        if (candidate.methodName === "fund_protected_native") {
          const { acceptedCancelDurationNs } = ContractMethodArgs.fund_protected_native.parse(candidate.args);
          prepared = prepareFundProtectedNative({ ...base, request, signerAccountId, observedAtNs, acceptedCancelDurationNs });
        } else if (candidate.methodName === "cancel_protected") prepared = prepareCancelProtected({ ...base, request, signerAccountId, observedAtNs });
        else if (candidate.methodName === "release_protected") prepared = prepareReleaseProtected({ ...base, request, observedAtNs });
        else prepared = prepareRetryProtectedTransfer({ ...base, request, signerAccountId });
      }
    } catch (error) {
      // A builder or schema refusal means the contract would refuse it too.
      if (error instanceof WalletEngineError) throw error;
      throw new WalletEngineError("CALL_NOT_ALLOWED");
    }
    if (canonicalJson(candidate) !== canonicalJson(prepared) || BigInt(prepared.gas) > WALLET_MAX_CALL_GAS)
      throw new WalletEngineError("CALL_NOT_ALLOWED");
    return JSON.parse(canonicalJson(prepared)) as PreparedProtectedCall;
  };
  const checkedCall = (candidate: WalletContractCall): Promise<WalletContractCall> =>
    protectedContract !== null && candidate.receiverId === protectedContract.accountId
      ? checkedProtected(candidate as PreparedProtectedCall) : checkedPayment(candidate as PreparedContractCall);
  const prepare = async (receiverId: string, amountNear: string | null, candidate: WalletContractCall | null, swapCandidate: PreparedWalletSwap | null = null) => {
    try { journal.assertClear(); } catch (blocked) {
      // An earlier attempt is unexplained (e.g. the page closed right after
      // sending). Settle it from FINAL chain data first: only an independently
      // verified outcome of the SAME hash clears it; otherwise stay blocked.
      if (!(blocked instanceof WalletEngineError) || blocked.code !== "OUTCOME_UNRESOLVED" || (await reconcile()).kind !== "final") throw blocked;
      journal.assertClear();
    }
    for (const [id, plan] of plans) if (now() >= plan.review.expiresAtMs) plans.delete(id);
    if (plans.size >= 20) throw new WalletEngineError("OUTCOME_UNRESOLVED");
    const state = await snapshot();
    if (swapCandidate !== null) {
      const swap = checkedSwapTransaction(swapCandidate, state.accountId);
      await chain.receiverExists(swap.receiverId, state.blockHash);
      const total = swap.actions.reduce((sum, a) => sum + BigInt(a.depositYocto), 0n).toString();
      const budget = spendingBudget(state, total);
      const encoded = swap.actions.map((a) => ({ ...a, argsJson: canonicalJson(a.args) }));
      if (encoded.some((a) => new TextEncoder().encode(a.argsJson).byteLength > 8192)) throw new WalletEngineError("CALL_NOT_ALLOWED");
      const tx = createTransaction(state.accountId, PublicKey.fromString(state.publicKey), swap.receiverId, BigInt(state.nonce) + 1n,
        encoded.map((a) => actions.functionCall(a.methodName, new TextEncoder().encode(a.argsJson), BigInt(a.gas), BigInt(a.depositYocto))), baseDecode(state.blockHash));
      const gasTotal = swap.actions.reduce((sum, a) => sum + BigInt(a.gas), 0n);
      if (gasTotal > MAX_SWAP_GAS) throw new WalletEngineError("CALL_NOT_ALLOWED");
      const review: WalletTransactionReview = Object.freeze({ id: crypto.randomUUID(), network: "near-testnet", kind: "token_swap",
        signerAccountId: state.accountId, publicKey: state.publicKey, receiverId: swap.receiverId, depositYocto: total, gas: gasTotal.toString(),
        methodName: swap.actions.map((a) => a.methodName).join("+"), argsJson: null, actionsJson: canonicalJson(swap.actions),
        nonce: tx.nonce.toString(), blockHash: state.blockHash, ...budget, expiresAtMs: now() + WALLET_REVIEW_TTL_MS });
      plans.set(review.id, { review, bytes: new Uint8Array(encodeTransaction(tx)), snapshot: state, call: null, swap });
      return review;
    }
    const call = candidate === null ? null : await checkedCall(candidate);
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
    plans.set(review.id, { review, bytes, snapshot: state, call, swap: null });
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
      const multi = tx.actions.length > 1;
      const raw = (multi ? TxResponseAnyActions : TxResponse).parse(await provider.viewTransactionStatusWithReceipts({ txHash: attempt.transactionHash, accountId: attempt.accountId, waitUntil: "FINAL" }));
      const t = raw.transaction;
      const action = tx.actions[0];
      const expectedOf = (a: (typeof tx.actions)[number] | undefined) => a?.transfer ? { Transfer: { deposit: a.transfer.deposit.toString() } } : a?.functionCall ? {
        FunctionCall: { method_name: a.functionCall.methodName, args: base64Encode(new Uint8Array(a.functionCall.args)), gas: Number(a.functionCall.gas), deposit: a.functionCall.deposit.toString() },
      } : null;
      const expectedActions = tx.actions.map(expectedOf);
      if (t.hash !== attempt.transactionHash || t.signer_id !== tx.signerId || t.receiver_id !== tx.receiverId ||
        t.public_key !== tx.publicKey.toString() || BigInt(t.nonce) !== tx.nonce || expectedActions.some((e) => e === null) ||
        t.actions.length !== expectedActions.length || canonicalJson(t.actions) !== canonicalJson(expectedActions))
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
    /** Protected Pay call on the configured escrow candidate; refused when none is configured. */
    prepareProtectedCall: (call: PreparedProtectedCall) => prepare(call.receiverId, null, JSON.parse(canonicalJson(call)) as PreparedProtectedCall),
    /** Curated Ref/Rhea Testnet swap (register / buy / sell); exact shapes only. */
    prepareSwapTransaction: (swap: PreparedWalletSwap) => prepare(swap.receiverId, null, null, swap),
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
        const contractLike = plan.call !== null || plan.swap !== null;
        if (contractLike && !input.policy.contractCallsPermitted()) throw new WalletEngineError("SIGNING_DISABLED");
        if (await confirm(plan.review) !== true) throw new WalletEngineError("REVIEW_REJECTED");
        if (!input.policy.signingPermitted() || (contractLike && !input.policy.contractCallsPermitted())) throw new WalletEngineError("SIGNING_DISABLED");
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
        if (plan.call) await checkedCall(plan.call);
        if (plan.swap) checkedSwapTransaction(plan.swap, current.accountId);
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
          broadcastLease = signed.assertActive; broadcastExpiresAt = plan.review.expiresAtMs; broadcastIsContract = contractLike;
          const response = await provider.sendTransactionUntil(signed.signedTransaction, "FINAL");
          if ((plan.swap ? TxResponseAnyActions : TxResponse).parse(response).transaction.hash !== hash) throw new WalletEngineError("OUTCOME_UNRESOLVED");
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
