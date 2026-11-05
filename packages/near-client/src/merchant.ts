import { z } from "zod";
import { AccountIdSchema, BlockRefSchema, ContractRequestSchema, HashHexSchema, SessionBindingSchema,
  ContractMethodArgs, IntentTermsSchema, PositiveU64Schema, calculateSessionCommitment, calculateTermsHash, comparisonCode,
  type SessionBinding, type IntentTerms } from "@taply/shared";
import { buildClient } from "./client.js";
import { parseConfig, type Fetch } from "./rpc.js";
import type { NearTestnetConfig, ReadResult } from "./types.js";
import { ContractConfigSchema, CreateQuoteSchema, contractConfigProblems, type CreateQuote, type PreparedContractCall, type PaymentRequestRead } from "./contract.js";
import { HashSchema } from "./validation.js";

export const MERCHANT_CONTRACT_VERSION = "0.5.0-merchant.1";
export interface MerchantDeployment {
  network: "near-testnet";
  contractId: string;
  codeHash: string;
}
const deploymentSchema = z.strictObject({ network: z.literal("near-testnet"), contractId: AccountIdSchema,
  codeHash: HashSchema });
function deployment(input: MerchantDeployment): MerchantDeployment {
  const d = deploymentSchema.parse(input);
  if (d.contractId === "taply-pay-pilot-1.testnet"
    || d.codeHash === "BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B") throw Error("PILOT_SESSION_BINDING_UNSUPPORTED");
  return d;
}

/** Trusted adapter boundary ONLY: result must originate from buildClient with the
 * same deployment pin. Parsing an arbitrary object cannot establish chain proof. */
export function verifyMerchantObservation(result: ReadResult<PaymentRequestRead>, expectedDeployment: MerchantDeployment,
  requestId: string, nowMs = Date.now()) {
  const d = deployment(expectedDeployment); HashHexSchema.parse(requestId);
  const o = result.observation;
  if (result.error || o.source !== "rpc" || o.assurance !== "verified_final" || !o.rpcAvailable || o.stale
    || !o.data || o.data.id !== requestId || !o.data.request || !o.observedBlock) throw Error("VERIFICATION_UNAVAILABLE");
  const block = BlockRefSchema.parse(o.observedBlock), request = ContractRequestSchema.parse(o.data.request);
  const t = request.terms, session = t.sessionBinding;
  const current = BigInt(nowMs) * 1_000_000n, blockTime = BigInt(block.timestampNs);
  const checked = Date.parse(o.checkedAt);
  if (!Number.isFinite(checked) || checked > nowMs + 30_000 || checked < nowMs - 120_000
    || blockTime > current + 30_000_000_000n || blockTime < current - 120_000_000_000n
    || BigInt(checked) * 1_000_000n < blockTime - 30_000_000_000n
    || BigInt(request.createdAtNs) > blockTime) throw Error("VERIFICATION_UNAVAILABLE");
  if (t.network !== d.network || t.contractId !== d.contractId || t.id !== requestId
    || t.mode !== "instant" || t.cancelDurationNs !== null || t.assetId !== "near:native"
    || t.merchantAccountId !== t.creatorAccountId || request.recipientAccountId !== t.creatorAccountId || !session)
    throw Error("MERCHANT_BINDING_INVALID");
  if (calculateTermsHash(t) !== request.termsHash || calculateSessionCommitment(t) !== request.sessionCommitment)
    throw Error("TERMS_MISMATCH");
  if (request.status !== "OPEN" || BigInt(t.fundingExpiresAtNs) <= blockTime
    || BigInt(session.expiresAtNs) <= blockTime || BigInt(session.expiresAtNs) <= current
    || BigInt(session.expiresAtNs) > BigInt(t.fundingExpiresAtNs)
    || BigInt(t.fundingExpiresAtNs) - BigInt(request.createdAtNs) > 86_400_000_000_000n
    || BigInt(session.expiresAtNs) - BigInt(request.createdAtNs) > 120_000_000_000n
    || BigInt(session.expiresAtNs) <= BigInt(request.createdAtNs)) throw Error("REQUEST_NOT_OPEN");
  return { request, comparisonCode: comparisonCode(request.sessionCommitment!), provenance: {
    ...d, observedBlock: block, checkedAt: o.checkedAt, trustModel: "configured-rpc" as const,
    evidenceKind: "CANONICAL_REQUEST_NOT_PAYOUT_RECEIPT" as const } };
}

export interface MerchantSessionExpectation {
  merchantAccountId: string;
  requestId: string;
  termsHash: string;
  sessionBinding: SessionBinding;
  /** Explicit policy, including null: server cannot add a payer restriction. */
  permittedPayerAccountId: string | null;
}
export function matchMerchantSession(verified: ReturnType<typeof verifyMerchantObservation>, expected: MerchantSessionExpectation) {
  AccountIdSchema.parse(expected.merchantAccountId); HashHexSchema.parse(expected.requestId); HashHexSchema.parse(expected.termsHash);
  const session = SessionBindingSchema.parse(expected.sessionBinding), t = verified.request.terms;
  if (expected.permittedPayerAccountId !== null) AccountIdSchema.parse(expected.permittedPayerAccountId);
  if (t.id !== expected.requestId || verified.request.termsHash !== expected.termsHash
    || t.creatorAccountId !== expected.merchantAccountId || t.merchantAccountId !== expected.merchantAccountId
    || t.sessionBinding?.id !== session.id || t.sessionBinding.nonce !== session.nonce
    || t.sessionBinding.expiresAtNs !== session.expiresAtNs
    || t.permittedPayerAccountId !== expected.permittedPayerAccountId) throw Error("SESSION_MISMATCH");
  return verified;
}

/** Read-only candidate seam. No default deployment, signer, gate or HTTP route.
 * Each client constructs its own reader using an operator-reviewed identity/hash.
 * buildClient checks exact Testnet genesis and code/hash/view at one final block. */
export function createMerchantRequestReader(config: NearTestnetConfig, fetcher: Fetch = (url, init) => globalThis.fetch(url, init), now = Date.now) {
  const parsed = parseConfig(config);
  if (!parsed.contract) throw Error("VERIFICATION_UNAVAILABLE");
  const d = deployment({ network: parsed.network, contractId: parsed.contract.accountId, codeHash: parsed.contract.expectedCodeHash });
  const client = buildClient(parsed, fetcher, false, () => new Date(now()));
  const read = async (id: string) => verifyMerchantObservation(await client.readPaymentRequest(id), d, id, now());
  return Object.freeze({ read, async readForSession(expected: MerchantSessionExpectation) {
    const pinned = structuredClone(expected);
    return matchMerchantSession(await read(pinned.requestId), pinned);
  }, async readCanonicalRequest(id: string) { return (await read(id)).request; } });
}

/** Candidate-only configuration schema; the approved pilot schema stays strict
 * at 0.4.0. Parsing config/quotes alone does not establish trusted chain reads. */
export const MerchantContractConfigSchema = ContractConfigSchema.extend({ contractVersion: z.literal(MERCHANT_CONTRACT_VERSION) });
export type MerchantContractConfig = z.infer<typeof MerchantContractConfigSchema>;
function checkedMerchantConfig(input: MerchantContractConfig, d: MerchantDeployment): MerchantContractConfig {
  const config = MerchantContractConfigSchema.parse(input);
  const base = { ...config, contractVersion: "0.4.0" as const, capabilities: { ...config.capabilities, handshake: false } };
  if (!config.capabilities.handshake || contractConfigProblems(base, d.contractId).length
    || BigInt(config.gas.callback) < 15_000_000_000_000n) throw Error("INVALID_CANDIDATE_CONFIG");
  return config;
}

/** Pure wallet call preparation. Caller must independently verify config/quote
 * against the reviewed deployment first; this function never invokes a wallet. */
export function prepareMerchantCreateRequest(input: { deployment: MerchantDeployment; config: MerchantContractConfig;
  terms: IntentTerms; quote: CreateQuote; signerAccountId: string; observedAtNs: string }): PreparedContractCall {
  const d = deployment(input.deployment), config = checkedMerchantConfig(input.config, d);
  const t = IntentTermsSchema.parse(input.terms), q = CreateQuoteSchema.parse(input.quote);
  const now = BigInt(PositiveU64Schema.parse(input.observedAtNs)), session = t.sessionBinding;
  if (t.contractId !== d.contractId || t.network !== d.network || t.mode !== "instant" || t.cancelDurationNs !== null
    || t.merchantAccountId !== t.creatorAccountId || input.signerAccountId !== t.creatorAccountId || !session
    || BigInt(session.expiresAtNs) <= now || BigInt(session.expiresAtNs) - now > 120_000_000_000n
    || BigInt(t.fundingExpiresAtNs) < BigInt(session.expiresAtNs) || BigInt(t.fundingExpiresAtNs) - now > 86_400_000_000_000n
    || q.requestId !== t.id || q.termsHash !== calculateTermsHash(t) || q.quoteVersion !== config.quoteVersion
    || BigInt(q.depositYocto) !== BigInt(q.storageBytes) * BigInt(config.storageByteCostYocto)
    || BigInt(q.gas) < BigInt(config.gas.createRequest)) throw Error("MERCHANT_BINDING_INVALID");
  return { receiverId: d.contractId, methodName: "create_request", gas: q.gas, depositYocto: q.depositYocto,
    args: ContractMethodArgs.create_request.parse({ terms: t, quoteVersion: q.quoteVersion }) };
}

/** Explicit payer preparation from independently read and matched terms. It is
 * still only a proposal: human review and wallet approval are always required. */
export function prepareMerchantPayInstantNative(input: { deployment: MerchantDeployment; config: MerchantContractConfig;
  canonical: ReturnType<typeof verifyMerchantObservation>; expected: MerchantSessionExpectation; signerAccountId: string;
  nowMs?: number }): PreparedContractCall {
  const d = deployment(input.deployment), config = checkedMerchantConfig(input.config, d);
  const v = matchMerchantSession(input.canonical, input.expected), p = v.provenance;
  if (p.network !== d.network || p.contractId !== d.contractId || p.codeHash !== d.codeHash) throw Error("MERCHANT_BINDING_INVALID");
  // Revalidate freshness and immutable data in case caller retained/mutated a read.
  const verified = verifyMerchantObservation({ error: null, observation: { source: "rpc", assurance: "verified_final", stale: false,
    rpcAvailable: true, data: { id: input.expected.requestId, request: v.request }, observedBlock: p.observedBlock,
    checkedAt: p.checkedAt } }, d, input.expected.requestId, input.nowMs ?? Date.now());
  AccountIdSchema.parse(input.signerAccountId);
  const t = verified.request.terms;
  if (t.permittedPayerAccountId !== null && t.permittedPayerAccountId !== input.signerAccountId) throw Error("PAYER_MISMATCH");
  return { receiverId: d.contractId, methodName: "pay_instant_native", gas: config.gas.payInstantNative,
    depositYocto: t.amountBaseUnits, args: ContractMethodArgs.pay_instant_native.parse({ id: t.id, expectedTermsHash: verified.request.termsHash }) };
}
