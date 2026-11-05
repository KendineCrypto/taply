import { z } from "zod";
import { AccountIdSchema, BlockRefSchema, ContractRequestSchema, HashHexSchema, SessionBindingSchema,
  calculateSessionCommitment, calculateTermsHash, comparisonCode,
  type SessionBinding } from "@taply/shared";
import { buildClient } from "./client.js";
import { parseConfig, type Fetch } from "./rpc.js";
import type { NearTestnetConfig, ReadResult } from "./types.js";
import type { PaymentRequestRead } from "./contract.js";
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
