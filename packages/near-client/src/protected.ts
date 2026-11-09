import { z } from "zod";
import {
  AccountIdSchema, ContractMethodArgs, Nep141AssetIdSchema, nep141TokenOf, ContractRequestSchema, IntentTermsSchema, MAX_CANCEL_DURATION_NS,
  MIN_CANCEL_DURATION_NS, PositiveU64Schema, U128Schema, U64Schema, calculateTermsHash,
  type ContractRequest, type IntentTerms,
} from "@taply/shared";
import { parseStrictJson } from "@taply/shared";
import { buildClient } from "./client.js";
import { CreateQuoteSchema, type CreateQuote } from "./contract.js";
import { NearClientError, createRpc, parseConfig, publicError, type Fetch } from "./rpc.js";
import type { NearTestnetClient, NearTestnetConfig, ReadResult } from "./types.js";
import { AccountSchema, BlockSchema, CallResultSchema } from "./validation.js";

/**
 * Protected Pay (G3) CANDIDATE contract seam: contracts/payments-protected.
 *
 * UNREVIEWED. Nothing here is wired to a default deployment. The pilot G1
 * contract is refused outright: it cannot hold escrow. Every builder repeats
 * the contract's own guards so a wallet is never asked to sign a call the
 * contract would reject, but the contract re-checks everything at execution
 * time and chain time decides cancel vs release, not these builders.
 */
export const PROTECTED_CONTRACT_VERSION = "0.5.0-g3-candidate";
export const PROTECTED_CONSENT_VERSION = "taply.protected-consent.v1";
const PILOT_CONTRACT_ID = "taply-pay-pilot-1.testnet";

export const ProtectedContractConfigSchema = z.strictObject({
  schemaVersion: z.literal("taply.contract-config.v1"),
  contractVersion: z.literal(PROTECTED_CONTRACT_VERSION),
  network: z.literal("near-testnet"),
  contractId: AccountIdSchema,
  intentVersion: z.literal("taply.intent.v1"),
  eventVersion: z.literal("0.4.0"),
  capabilities: z.strictObject({
    instantNative: z.boolean(), protectedPay: z.boolean(), handshake: z.boolean(),
    merchantProfiles: z.boolean(), nep141: z.boolean(), sponsoredGas: z.boolean(),
  }),
  quoteVersion: PositiveU64Schema,
  storageByteCostYocto: U128Schema,
  gas: z.strictObject({
    createRequest: PositiveU64Schema, payInstantNative: PositiveU64Schema,
    retryNativeTransfer: PositiveU64Schema, cancelUnfunded: PositiveU64Schema, callback: PositiveU64Schema,
    fundProtectedNative: PositiveU64Schema, cancelProtected: PositiveU64Schema, releaseProtected: PositiveU64Schema,
    ftOnTransfer: PositiveU64Schema.optional(), ftTransfer: PositiveU64Schema.optional(),
  }),
  // NEP-141 allowlist fixed at contract init (absent on the first candidate build).
  tokens: z.array(z.strictObject({
    assetId: Nep141AssetIdSchema, accountId: AccountIdSchema,
    decimals: z.number().int().min(0).max(24), symbol: z.string().regex(/^[A-Za-z0-9-]{1,16}$/),
  })).max(8).optional(),
  protected: z.strictObject({
    consentVersion: z.literal(PROTECTED_CONSENT_VERSION),
    minCancelDurationNs: z.literal(MIN_CANCEL_DURATION_NS.toString()),
    maxCancelDurationNs: z.literal(MAX_CANCEL_DURATION_NS.toString()),
    cutoffRule: z.literal("CANCEL_IF_BLOCK_TIME_LT_CUTOFF_RELEASE_IF_GTE"),
    reviewStatus: z.enum(["UNREVIEWED_NOT_FOR_REAL_FUNDS"]),
  }),
  storageRefundPolicy: z.literal("PERMANENT_RECORD_NO_WITHDRAWAL"),
  unknownCallbackPolicy: z.literal("IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE"),
  testFaultBuild: z.boolean(),
});
export type ProtectedContractConfig = z.infer<typeof ProtectedContractConfigSchema>;

/** Minimum gas the candidate enforces (contracts/payments-protected/src/lib.rs). */
export const PROTECTED_MINIMUM_GAS = Object.freeze({
  createRequest: 30_000_000_000_000n,
  fundProtectedNative: 20_000_000_000_000n,
  cancelProtected: 50_000_000_000_000n,
  releaseProtected: 50_000_000_000_000n,
  retryNativeTransfer: 50_000_000_000_000n,
});

export type ProtectedConfigProblem =
  | "PILOT_CANNOT_HOLD_ESCROW" | "CONTRACT_ID_MISMATCH" | "TEST_FAULT_BUILD" | "PROTECTED_DISABLED"
  | "UNSUPPORTED_CAPABILITY" | "UNSUPPORTED_QUOTE_VERSION" | "GAS_BELOW_MINIMUM" | "UNREVIEWED_CANDIDATE";

/**
 * Everything that must hold before a frontend may offer Protected Pay. While the
 * candidate is unreviewed the list ALWAYS contains UNREVIEWED_CANDIDATE; only a
 * protected QA build may choose to accept that single problem, and never for
 * real funds.
 */
export function protectedConfigProblems(config: ProtectedContractConfig, expectedContractId: string): ProtectedConfigProblem[] {
  const problems: ProtectedConfigProblem[] = [];
  if (expectedContractId === PILOT_CONTRACT_ID || config.contractId === PILOT_CONTRACT_ID) problems.push("PILOT_CANNOT_HOLD_ESCROW");
  if (config.contractId !== expectedContractId) problems.push("CONTRACT_ID_MISMATCH");
  if (config.testFaultBuild) problems.push("TEST_FAULT_BUILD");
  if (!config.capabilities.protectedPay) problems.push("PROTECTED_DISABLED");
  const { handshake, merchantProfiles, nep141, sponsoredGas } = config.capabilities;
  if (handshake || merchantProfiles || sponsoredGas) problems.push("UNSUPPORTED_CAPABILITY");
  // nep141 must agree with a consistent allowlist; tokens without the flag (or the reverse) is malformed.
  const tokens = config.tokens ?? [];
  if (nep141 !== tokens.length > 0 || tokens.some((t) => t.assetId !== `nep141:${t.accountId}`)) problems.push("UNSUPPORTED_CAPABILITY");
  if (config.quoteVersion !== "1") problems.push("UNSUPPORTED_QUOTE_VERSION");
  const { gas } = config;
  if (BigInt(gas.createRequest) < PROTECTED_MINIMUM_GAS.createRequest
    || BigInt(gas.fundProtectedNative) < PROTECTED_MINIMUM_GAS.fundProtectedNative
    || BigInt(gas.cancelProtected) < PROTECTED_MINIMUM_GAS.cancelProtected
    || BigInt(gas.releaseProtected) < PROTECTED_MINIMUM_GAS.releaseProtected
    || BigInt(gas.retryNativeTransfer) < PROTECTED_MINIMUM_GAS.retryNativeTransfer) problems.push("GAS_BELOW_MINIMUM");
  if (config.protected.reviewStatus === "UNREVIEWED_NOT_FOR_REAL_FUNDS") problems.push("UNREVIEWED_CANDIDATE");
  return problems;
}

export interface PreparedProtectedCall {
  receiverId: string;
  methodName: "create_request" | "fund_protected_native" | "cancel_protected" | "release_protected" | "retry_native_transfer";
  args: Record<string, unknown>;
  gas: string;
  depositYocto: string;
}

function refuse(): never {
  throw new NearClientError("INVALID_ARGUMENT", false);
}

function protectedTerms(contractId: string, terms: IntentTerms): IntentTerms {
  if (contractId === PILOT_CONTRACT_ID) refuse();
  const parsed = IntentTermsSchema.safeParse(terms);
  if (!parsed.success) refuse();
  const value = parsed.data;
  // Candidate: native Protected only, no merchant/session binding.
  if (value.contractId !== contractId || value.mode !== "protected" || value.cancelDurationNs === null
    || value.merchantAccountId !== null || value.sessionBinding !== null) refuse();
  return value;
}

function request(contractId: string, input: ContractRequest): ContractRequest {
  const parsed = ContractRequestSchema.safeParse(input);
  if (!parsed.success) refuse();
  protectedTerms(contractId, parsed.data.terms);
  return parsed.data;
}

function observed(ns: string): bigint {
  if (!U64Schema.safeParse(ns).success) refuse();
  return BigInt(ns);
}

function checkedArgs<K extends keyof typeof ContractMethodArgs>(method: K, args: unknown): Record<string, unknown> {
  const parsed = ContractMethodArgs[method].safeParse(args);
  if (!parsed.success) refuse();
  return parsed.data as Record<string, unknown>;
}

/** Recipient signs the immutable Protected terms, including the cancel duration. */
export function prepareCreateProtectedRequest(input: {
  contractId: string; config: ProtectedContractConfig; terms: IntentTerms; quote: CreateQuote; signerAccountId: string;
}): PreparedProtectedCall {
  const terms = protectedTerms(input.contractId, input.terms);
  if (!assetAllowed(input.config, terms.assetId)) refuse();
  const quote = CreateQuoteSchema.safeParse(input.quote);
  if (!quote.success) refuse();
  const { requestId, termsHash, quoteVersion, depositYocto, gas } = quote.data;
  if (input.signerAccountId !== terms.creatorAccountId) refuse();
  if (requestId !== terms.id || termsHash !== calculateTermsHash(terms) || quoteVersion !== input.config.quoteVersion) refuse();
  if (BigInt(gas) < BigInt(input.config.gas.createRequest)) refuse();
  return { receiverId: input.contractId, methodName: "create_request", gas, depositYocto,
    args: checkedArgs("create_request", { terms, quoteVersion }) };
}

/**
 * Payer consent + exact principal. `acceptedCancelDurationNs` is what the
 * consent screen SHOWED; it must equal the signed terms or nothing is built.
 */
export function prepareFundProtectedNative(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; signerAccountId: string;
  observedAtNs: string; acceptedCancelDurationNs: string;
}): PreparedProtectedCall {
  const r = request(input.contractId, input.request);
  const terms = r.terms;
  if (terms.assetId !== "near:native") refuse();
  if (r.status !== "OPEN" || observed(input.observedAtNs) >= BigInt(terms.fundingExpiresAtNs)) refuse();
  if (terms.permittedPayerAccountId !== null && terms.permittedPayerAccountId !== input.signerAccountId) refuse();
  if (input.acceptedCancelDurationNs !== terms.cancelDurationNs) refuse();
  return { receiverId: input.contractId, methodName: "fund_protected_native", gas: input.config.gas.fundProtectedNative,
    depositYocto: terms.amountBaseUnits,
    args: checkedArgs("fund_protected_native", { id: terms.id, expectedTermsHash: r.termsHash,
      acceptedCancelDurationNs: terms.cancelDurationNs, consentVersion: PROTECTED_CONSENT_VERSION }) };
}

/**
 * Payer-only refund request while the observed final block is before the
 * cutoff. Inclusion before the cutoff is NOT guaranteed by building this.
 */
export function prepareCancelProtected(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; signerAccountId: string; observedAtNs: string;
}): PreparedProtectedCall {
  const r = request(input.contractId, input.request);
  if (r.status !== "LOCKED" || r.cancelUntilNs === null || r.payerAccountId !== input.signerAccountId) refuse();
  if (observed(input.observedAtNs) >= BigInt(r.cancelUntilNs)) refuse();
  return { receiverId: input.contractId, methodName: "cancel_protected", gas: input.config.gas.cancelProtected,
    depositYocto: "1", args: checkedArgs("cancel_protected", { id: r.terms.id, expectedTermsHash: r.termsHash }) };
}

/** Anyone may release once a final block at/after the cutoff has been observed. */
export function prepareReleaseProtected(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; observedAtNs: string;
}): PreparedProtectedCall {
  const r = request(input.contractId, input.request);
  if (r.status !== "LOCKED" || r.cancelUntilNs === null) refuse();
  if (observed(input.observedAtNs) < BigInt(r.cancelUntilNs)) refuse();
  return { receiverId: input.contractId, methodName: "release_protected", gas: input.config.gas.releaseProtected,
    depositYocto: "1", args: checkedArgs("release_protected", { id: r.terms.id }) };
}

/** Beneficiary-only retry of a RECORDED refund/release failure: same branch, same nonce. */
export function prepareRetryProtectedTransfer(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; signerAccountId: string;
}): PreparedProtectedCall {
  const r = request(input.contractId, input.request);
  const op = r.latestOperation;
  if (op === null || op.status !== "FAILED") refuse();
  const refund = r.status === "REFUND_FAILED_RECOVERABLE" && op.kind === "PROTECTED_REFUND";
  const release = r.status === "RELEASE_FAILED_RECOVERABLE" && op.kind === "PROTECTED_RELEASE";
  if (!refund && !release) refuse();
  const beneficiary = refund ? r.payerAccountId : r.recipientAccountId;
  if (input.signerAccountId !== beneficiary || op.destinationAccountId !== beneficiary) refuse();
  return { receiverId: input.contractId, methodName: "retry_native_transfer", gas: input.config.gas.retryNativeTransfer,
    depositYocto: "1", args: checkedArgs("retry_native_transfer", { id: r.terms.id, expectedOperationNonce: op.nonce }) };
}

export interface ProtectedReader {
  /** Generic reads (network, request, quote, receipts) pinned to the candidate code hash. */
  readonly client: NearTestnetClient;
  /** `get_config` of the candidate at one final block where the code hash matched. */
  readConfig(): Promise<ReadResult<ProtectedContractConfig>>;
}

/**
 * Reader for an operator-configured candidate deployment. Refuses the G1 pilot.
 * The config read repeats buildClient's anchoring rules: network check, then
 * code hash and view at the SAME final block.
 */
export function createProtectedReader(input: NearTestnetConfig, fetcher: Fetch = (url, init) => globalThis.fetch(url, init),
  now: () => Date = () => new Date()): ProtectedReader {
  const config = parseConfig(input);
  if (config.contract === null || config.contract.accountId === PILOT_CONTRACT_ID) throw new NearClientError("INVALID_CONFIG", false);
  const contract = config.contract;
  const client = buildClient(config, fetcher, false, now);
  const rpc = createRpc(config, fetcher);
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const result = schema.safeParse(value);
    if (!result.success) throw new NearClientError("RPC_MALFORMED_RESPONSE");
    return result.data;
  };
  const readConfig = async (): Promise<ReadResult<ProtectedContractConfig>> => {
    const network = await client.checkNetwork();
    if (network.error !== null) return { observation: { ...network.observation, data: null }, error: network.error };
    try {
      const block = parse(BlockSchema, await rpc("block", { finality: "final" }));
      const anchored = (v: { block_hash: string; block_height: string }) => {
        if (v.block_hash !== block.hash || v.block_height !== block.height) throw new NearClientError("EVIDENCE_MISMATCH");
      };
      const code = parse(AccountSchema, await rpc("query", { request_type: "view_account", account_id: contract.accountId, block_id: block.hash }));
      anchored(code);
      if (code.code_hash !== contract.expectedCodeHash) throw new NearClientError("CONTRACT_CODE_MISMATCH");
      const call = parse(CallResultSchema, await rpc("query", { request_type: "call_function", account_id: contract.accountId,
        method_name: "get_config", args_base64: btoa("{}"), block_id: block.hash }));
      anchored(call);
      let decoded: unknown;
      try { decoded = parseStrictJson(Uint8Array.from(call.result)); } catch { throw new NearClientError("RPC_MALFORMED_RESPONSE"); }
      const data = parse(ProtectedContractConfigSchema, decoded);
      if (data.contractId !== contract.accountId) throw new NearClientError("EVIDENCE_MISMATCH");
      return { observation: { source: "rpc", assurance: "verified_final", data, observedBlock: block,
        checkedAt: now().toISOString(), stale: false, rpcAvailable: true }, error: null };
    } catch (cause) {
      const error = cause instanceof NearClientError ? cause : new NearClientError("RPC_MALFORMED_RESPONSE");
      const mismatch = ["CONTRACT_CODE_MISMATCH", "EVIDENCE_MISMATCH"].includes(error.code);
      return { observation: { source: "rpc", assurance: mismatch ? "mismatch" : "unknown", data: null, observedBlock: null,
        checkedAt: now().toISOString(), stale: false, rpcAvailable: error.rpcAvailable }, error: publicError(error, config.rpcProviderId) };
    }
  };
  return Object.freeze({ client, readConfig });
}

/** True for native NEAR or a token on the contract's own verified allowlist. */
export function assetAllowed(config: ProtectedContractConfig, assetId: string): boolean {
  if (assetId === "near:native") return true;
  return (config.tokens ?? []).some((t) => t.assetId === assetId);
}

/** Instant terms for the candidate (native or allowlisted token). */
function candidateInstantTerms(contractId: string, terms: IntentTerms): IntentTerms {
  if (contractId === PILOT_CONTRACT_ID) refuse();
  const parsed = IntentTermsSchema.safeParse(terms);
  if (!parsed.success) refuse();
  const value = parsed.data;
  if (value.contractId !== contractId || value.mode !== "instant" || value.cancelDurationNs !== null
    || value.merchantAccountId !== null || value.sessionBinding !== null) refuse();
  return value;
}

/** Recipient signs a token (or native) Instant request on the candidate. */
export function prepareCreateCandidateInstantRequest(input: {
  contractId: string; config: ProtectedContractConfig; terms: IntentTerms; quote: CreateQuote; signerAccountId: string;
}): PreparedProtectedCall {
  const terms = candidateInstantTerms(input.contractId, input.terms);
  if (!assetAllowed(input.config, terms.assetId)) refuse();
  const quote = CreateQuoteSchema.safeParse(input.quote);
  if (!quote.success) refuse();
  const { requestId, termsHash, quoteVersion, depositYocto, gas } = quote.data;
  if (input.signerAccountId !== terms.creatorAccountId) refuse();
  if (requestId !== terms.id || termsHash !== calculateTermsHash(terms) || quoteVersion !== input.config.quoteVersion) refuse();
  return { receiverId: input.contractId, methodName: "create_request", gas, depositYocto,
    args: checkedArgs("create_request", { terms, quoteVersion }) };
}

/** A NEP-141 call on the TOKEN contract (not on Taply's contract). */
export interface PreparedTokenCall {
  receiverId: string;
  methodName: "ft_transfer_call" | "storage_deposit";
  args: Record<string, unknown>;
  gas: string;
  depositYocto: string;
}

/** Gas for ft_transfer_call: token transfer + Taply ft_on_transfer + payout + callback + resolve. */
export const FT_TRANSFER_CALL_GAS = "100000000000000";

/**
 * Payer funds a token request: `ft_transfer_call` on the allowlisted token with
 * EXACTLY the principal, 1 yoctoNEAR (NEP-141), receiver = Taply's contract, and
 * a strict msg naming only the request. The contract re-checks token, payer,
 * amount, terms and (Protected) the accepted window; on any failure the token
 * returns the whole amount to the payer.
 */
export function prepareTokenFunding(input: {
  contractId: string; config: ProtectedContractConfig; request: ContractRequest; signerAccountId: string;
  observedAtNs: string; acceptedCancelDurationNs?: string;
}): PreparedTokenCall {
  const parsed = ContractRequestSchema.safeParse(input.request);
  if (!parsed.success) refuse();
  const r = parsed.data;
  const terms = r.terms.mode === "protected" ? protectedTerms(input.contractId, r.terms) : candidateInstantTerms(input.contractId, r.terms);
  const token = nep141TokenOf(terms.assetId);
  if (token === null || !assetAllowed(input.config, terms.assetId)) refuse();
  if (r.status !== "OPEN" || observed(input.observedAtNs) >= BigInt(terms.fundingExpiresAtNs)) refuse();
  if (terms.permittedPayerAccountId !== null && terms.permittedPayerAccountId !== input.signerAccountId) refuse();
  const msg: Record<string, string> = { id: terms.id, expectedTermsHash: r.termsHash,
    action: terms.mode === "protected" ? "fund_protected" : "pay_instant" };
  if (terms.mode === "protected") {
    if (input.acceptedCancelDurationNs !== terms.cancelDurationNs) refuse();
    msg.acceptedCancelDurationNs = terms.cancelDurationNs!;
    msg.consentVersion = PROTECTED_CONSENT_VERSION;
  }
  return { receiverId: token, methodName: "ft_transfer_call", gas: FT_TRANSFER_CALL_GAS, depositYocto: "1",
    args: { receiver_id: input.contractId, amount: terms.amountBaseUnits, memo: null, msg: JSON.stringify(msg) } };
}

/** NEP-145 registration so an account can RECEIVE the token (payout/refund). */
export function prepareTokenStorageDeposit(input: { tokenAccountId: string; accountId: string; depositYocto: string }): PreparedTokenCall {
  if (!AccountIdSchema.safeParse(input.tokenAccountId).success || !AccountIdSchema.safeParse(input.accountId).success
    || !/^[1-9][0-9]{0,38}$/.test(input.depositYocto)) refuse();
  return { receiverId: input.tokenAccountId, methodName: "storage_deposit", gas: "10000000000000",
    depositYocto: input.depositYocto, args: { account_id: input.accountId, registration_only: true } };
}
