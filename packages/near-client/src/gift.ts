import { z } from "zod";
import { AccountIdSchema, U128Schema, U64Schema, parseStrictJson } from "@taply/shared";
import { buildClient } from "./client.js";
import { NearClientError, createRpc, parseConfig, publicError, type Fetch } from "./rpc.js";
import { ed25519SeedToPkcs8 } from "./recovery-phrase.js";
import type { NearTestnetConfig, NearTestnetClient, ReadResult } from "./types.js";
import { AccountSchema, BlockSchema, CallResultSchema, HashSchema } from "./validation.js";

/**
 * Taply Gift (contracts/gift) client seam. NEAR Testnet only, UNREVIEWED.
 *
 * Every read is anchored to ONE final block at which the configured code hash
 * matched. Every builder repeats the contract's guards so a wallet is never
 * asked to sign a call the contract would refuse; the contract re-checks all
 * of it at execution time, and chain time decides claim vs refund.
 *
 * The "link key" is a one-off ed25519 key generated in the creator's browser.
 * Its 32-byte seed lives only in the share URL fragment (`#k=`), never on a
 * server; the contract stores only its public key and accepts a claim signed
 * by it for exactly `taply-gift-claim:v1:<contract>:<gift id>:<claimant>`.
 */
export const GIFT_CONTRACT_VERSION = "0.1.0";
export const GIFT_CLAIM_DOMAIN = "taply-gift-claim:v1";
export const GIFT_CREATE_GAS = 30_000_000_000_000n;
export const GIFT_SETTLE_GAS = 50_000_000_000_000n;
const GIFT_ID = /^[0-9a-f]{32}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{128}$/;

export const GiftConfigSchema = z.strictObject({
  contract: z.literal("taply-gift"),
  version: z.literal(GIFT_CONTRACT_VERSION),
  reviewStatus: z.enum(["UNREVIEWED_NOT_FOR_REAL_FUNDS"]),
  asset: z.literal("near:native"),
  giftFeeYocto: U128Schema,
  minAmountYocto: U128Schema,
  maxAmountYocto: U128Schema,
  minLifetimeS: U64Schema,
  maxLifetimeS: U64Schema,
  maxMessageBytes: z.number().int().min(0).max(1024),
  maxDesign: z.number().int().min(0).max(255),
  claimDomain: z.literal(GIFT_CLAIM_DOMAIN),
});
export type GiftConfig = z.infer<typeof GiftConfigSchema>;

export const GiftViewSchema = z.strictObject({
  id: z.string().regex(GIFT_ID),
  creator: AccountIdSchema,
  amountYocto: U128Schema,
  publicKey: z.string().regex(HEX32),
  message: z.string().max(1024),
  design: z.number().int().min(0).max(255),
  createdAtNs: U64Schema,
  createdHeight: U64Schema,
  expiresAtNs: U64Schema,
  status: z.enum(["AVAILABLE", "EXPIRED", "CLAIMED", "REFUNDED"]),
  beneficiary: AccountIdSchema.nullable(),
  settledAtNs: U64Schema.nullable(),
  settledHeight: U64Schema.nullable(),
  payout: z.enum(["PENDING", "CONFIRMED", "FAILED"]).nullable(),
  payoutNonce: z.number().int().min(1).max(0xffff_ffff).nullable(),
}).superRefine((g, ctx) => {
  const settled = g.status === "CLAIMED" || g.status === "REFUNDED";
  const fields = [g.beneficiary, g.settledAtNs, g.settledHeight, g.payout, g.payoutNonce];
  if (settled ? fields.some((f) => f === null) : fields.some((f) => f !== null)) ctx.addIssue({ code: "custom", message: "settlement" });
  if (g.status === "REFUNDED" && g.beneficiary !== g.creator) ctx.addIssue({ code: "custom", message: "refund beneficiary" });
  if (g.status === "CLAIMED" && g.beneficiary === g.creator) ctx.addIssue({ code: "custom", message: "creator claim" });
});
export type GiftView = z.infer<typeof GiftViewSchema>;

export interface GiftRead {
  readonly gift: GiftView | null;
  /** Chain time of the final block the gift was read at (claim/refund guards use it). */
  readonly observedAtNs: string;
}

export interface PreparedGiftCall {
  receiverId: string;
  methodName: "create_gift" | "claim_gift" | "refund_gift" | "retry_payout";
  args: Record<string, unknown>;
  gas: string;
  depositYocto: string;
}

export type GiftConfigProblem = "CONTRACT_ID_MISMATCH" | "UNREVIEWED_CANDIDATE";

/** UNREVIEWED_CANDIDATE is always reported until the contract says otherwise. */
export function giftConfigProblems(config: GiftConfig, expectedContractId: string, observedContractId: string): GiftConfigProblem[] {
  const problems: GiftConfigProblem[] = [];
  if (expectedContractId !== observedContractId) problems.push("CONTRACT_ID_MISMATCH");
  if (config.reviewStatus === "UNREVIEWED_NOT_FOR_REAL_FUNDS") problems.push("UNREVIEWED_CANDIDATE");
  return problems;
}

function refuse(): never {
  throw new NearClientError("INVALID_ARGUMENT", false);
}
function account(id: string): string {
  if (!AccountIdSchema.safeParse(id).success) refuse();
  return id;
}
export function isGiftId(id: string): boolean {
  return GIFT_ID.test(id);
}
function utf8Length(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}
/** Same rule as the contract: control characters except newline are refused. */
export function giftMessageProblem(message: string, config: Pick<GiftConfig, "maxMessageBytes">): "TOO_LONG" | "INVALID" | null {
  if (utf8Length(message) > config.maxMessageBytes) return "TOO_LONG";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(message)) return "INVALID";
  return null;
}

export function prepareCreateGift(input: {
  contractId: string; config: GiftConfig; signerAccountId: string; giftId: string; publicKeyHex: string;
  amountYocto: string; lifetimeS: number; message: string; design: number;
}): PreparedGiftCall {
  account(input.contractId); account(input.signerAccountId);
  const { config } = input;
  if (!isGiftId(input.giftId) || !HEX32.test(input.publicKeyHex)) refuse();
  if (!U128Schema.safeParse(input.amountYocto).success) refuse();
  const amount = BigInt(input.amountYocto);
  if (amount < BigInt(config.minAmountYocto) || amount > BigInt(config.maxAmountYocto)) refuse();
  if (!Number.isSafeInteger(input.lifetimeS) || input.lifetimeS < Number(config.minLifetimeS) || input.lifetimeS > Number(config.maxLifetimeS)) refuse();
  if (giftMessageProblem(input.message, config) !== null) refuse();
  if (!Number.isInteger(input.design) || input.design < 0 || input.design > config.maxDesign) refuse();
  return {
    receiverId: input.contractId, methodName: "create_gift",
    args: { gift_id: input.giftId, public_key: input.publicKeyHex, amount: input.amountYocto, lifetime_s: input.lifetimeS,
      message: input.message, design: input.design },
    gas: GIFT_CREATE_GAS.toString(), depositYocto: (amount + BigInt(config.giftFeeYocto)).toString(),
  };
}

function gift(input: GiftView): GiftView {
  const parsed = GiftViewSchema.safeParse(input);
  if (!parsed.success) refuse();
  return parsed.data;
}
function observed(ns: string): bigint {
  if (!U64Schema.safeParse(ns).success) refuse();
  return BigInt(ns);
}
/** The raw on-chain outcome is still AVAILABLE (EXPIRED is a derived view). */
function unsettled(g: GiftView): boolean {
  return g.status === "AVAILABLE" || g.status === "EXPIRED";
}

export function prepareClaimGift(input: {
  contractId: string; gift: GiftView; signerAccountId: string; signatureHex: string; observedAtNs: string;
}): PreparedGiftCall {
  account(input.contractId);
  const signer = account(input.signerAccountId);
  const g = gift(input.gift);
  if (!unsettled(g) || observed(input.observedAtNs) >= BigInt(g.expiresAtNs) || signer === g.creator || !HEX64.test(input.signatureHex)) refuse();
  return { receiverId: input.contractId, methodName: "claim_gift", args: { gift_id: g.id, signature: input.signatureHex },
    gas: GIFT_SETTLE_GAS.toString(), depositYocto: "0" };
}

export function prepareRefundGift(input: { contractId: string; gift: GiftView; signerAccountId: string; observedAtNs: string }): PreparedGiftCall {
  account(input.contractId);
  const signer = account(input.signerAccountId);
  const g = gift(input.gift);
  if (!unsettled(g) || signer !== g.creator || observed(input.observedAtNs) < BigInt(g.expiresAtNs)) refuse();
  return { receiverId: input.contractId, methodName: "refund_gift", args: { gift_id: g.id }, gas: GIFT_SETTLE_GAS.toString(), depositYocto: "0" };
}

export function prepareRetryGiftPayout(input: { contractId: string; gift: GiftView; signerAccountId: string }): PreparedGiftCall {
  account(input.contractId);
  const signer = account(input.signerAccountId);
  const g = gift(input.gift);
  if (g.payout !== "FAILED" || g.beneficiary !== signer) refuse();
  return { receiverId: input.contractId, methodName: "retry_payout", args: { gift_id: g.id }, gas: GIFT_SETTLE_GAS.toString(), depositYocto: "0" };
}

// ---------- link key (ed25519 via Web Crypto, same primitive as the Taply Wallet vault) ----------

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
}

/** 43-character URL-safe encoding of the 32-byte link-key seed. */
export function encodeGiftSecret(seed: Uint8Array): string {
  if (seed.length !== 32) refuse();
  return b64url(seed);
}
export function decodeGiftSecret(text: string): Uint8Array | null {
  if (text.length !== 43) return null;
  const bytes = unb64url(text);
  return bytes !== null && bytes.length === 32 ? bytes : null;
}
export function claimMessage(contractId: string, giftId: string, claimant: string): string {
  return `${GIFT_CLAIM_DOMAIN}:${account(contractId)}:${isGiftId(giftId) ? giftId : refuse()}:${account(claimant)}`;
}
async function signingKey(crypto: Crypto, seed: Uint8Array): Promise<CryptoKey> {
  if (seed.length !== 32) refuse();
  return crypto.subtle.importKey("pkcs8", ed25519SeedToPkcs8(seed), { name: "Ed25519" }, true, ["sign"]);
}
export async function giftPublicKeyHex(crypto: Crypto, seed: Uint8Array): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", await signingKey(crypto, seed));
  const x = typeof jwk.x === "string" ? unb64url(jwk.x) : null;
  if (x === null || x.length !== 32) throw new NearClientError("INVALID_ARGUMENT", false);
  return hex(x);
}
/** A fresh random gift id (128 bits) and link key. Nothing is stored. */
export async function newGiftLink(crypto: Crypto): Promise<{ giftId: string; seed: Uint8Array; publicKeyHex: string }> {
  const id = crypto.getRandomValues(new Uint8Array(16));
  const seed = crypto.getRandomValues(new Uint8Array(32));
  return { giftId: hex(id), seed, publicKeyHex: await giftPublicKeyHex(crypto, seed) };
}
export async function signGiftClaim(crypto: Crypto, seed: Uint8Array, contractId: string, giftId: string, claimant: string): Promise<string> {
  const message = new TextEncoder().encode(claimMessage(contractId, giftId, claimant));
  return hex(new Uint8Array(await crypto.subtle.sign("Ed25519", await signingKey(crypto, seed), message)));
}
export async function verifyGiftClaim(crypto: Crypto, publicKeyHex: string, contractId: string, giftId: string, claimant: string, signatureHex: string): Promise<boolean> {
  if (!HEX32.test(publicKeyHex) || !HEX64.test(signatureHex)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", unhex(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, unhex(signatureHex), new TextEncoder().encode(claimMessage(contractId, giftId, claimant)));
  } catch { return false; }
}

// ---------- reads ----------

export interface GiftReader {
  readonly client: NearTestnetClient;
  readConfig(): Promise<ReadResult<GiftConfig>>;
  readGift(giftId: string): Promise<ReadResult<GiftRead>>;
}

export function createGiftReader(input: NearTestnetConfig, fetcher: Fetch = (url, init) => globalThis.fetch(url, init),
  now: () => Date = () => new Date()): GiftReader {
  const config = parseConfig(input);
  if (config.contract === null) throw new NearClientError("INVALID_CONFIG", false);
  const contract = config.contract;
  const client = buildClient(config, fetcher, false, now);
  const rpc = createRpc(config, fetcher);
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const result = schema.safeParse(value);
    if (!result.success) throw new NearClientError("RPC_MALFORMED_RESPONSE");
    return result.data;
  };
  /** One final block, code hash checked at it, then the view at the same block. */
  const anchoredView = async <T>(method: string, args: unknown, decode: (value: unknown, block: { hash: string; height: string; timestampNs: string }) => T): Promise<ReadResult<T>> => {
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
        method_name: method, args_base64: btoa(JSON.stringify(args)), block_id: block.hash }));
      anchored(call);
      let decoded: unknown;
      try { decoded = parseStrictJson(Uint8Array.from(call.result)); } catch { throw new NearClientError("RPC_MALFORMED_RESPONSE"); }
      const data = decode(decoded, block);
      return { observation: { source: "rpc", assurance: "verified_final", data, observedBlock: block,
        checkedAt: now().toISOString(), stale: false, rpcAvailable: true }, error: null };
    } catch (cause) {
      const error = cause instanceof NearClientError ? cause : new NearClientError("RPC_MALFORMED_RESPONSE");
      const mismatch = ["CONTRACT_CODE_MISMATCH", "EVIDENCE_MISMATCH"].includes(error.code);
      return { observation: { source: "rpc", assurance: mismatch ? "mismatch" : "unknown", data: null, observedBlock: null,
        checkedAt: now().toISOString(), stale: false, rpcAvailable: error.rpcAvailable }, error: publicError(error, config.rpcProviderId) };
    }
  };
  return Object.freeze({
    client,
    readConfig: () => anchoredView("get_config", {}, (v) => parse(GiftConfigSchema, v)),
    readGift: async (giftId: string): Promise<ReadResult<GiftRead>> => {
      if (!isGiftId(giftId)) {
        const error = publicError(new NearClientError("INVALID_ARGUMENT", false), config.rpcProviderId);
        return { observation: { source: "rpc", assurance: "unknown", data: null, observedBlock: null, checkedAt: now().toISOString(), stale: false, rpcAvailable: true }, error };
      }
      return anchoredView("get_gift", { gift_id: giftId }, (v, block) => {
        const g = v === null ? null : parse(GiftViewSchema, v);
        if (g !== null && g.id !== giftId) throw new NearClientError("EVIDENCE_MISMATCH");
        return { gift: g, observedAtNs: block.timestampNs };
      });
    },
  });
}

// ---------- Personal Gift: independent check of a direct NEAR transfer ----------

const TransferTxSchema = z.object({
  final_execution_status: z.literal("FINAL"),
  status: z.unknown(),
  transaction: z.object({ hash: HashSchema, signer_id: AccountIdSchema, receiver_id: AccountIdSchema, actions: z.array(z.unknown()) }),
  transaction_outcome: z.object({ block_hash: HashSchema, outcome: z.object({ status: z.unknown() }) }),
  receipts_outcome: z.array(z.object({ id: z.string(), block_hash: HashSchema, outcome: z.object({ executor_id: z.string(), status: z.unknown() }) })),
});

export type DirectTransferCheck =
  | { readonly kind: "VERIFIED"; readonly blockHash: string; readonly blockTimestampNs: string }
  /** The chain shows something different (other amount/accounts, or a failure). */
  | { readonly kind: "MISMATCH" }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNAVAILABLE" };

/**
 * A Personal Gift is a plain NEAR transfer. This checks, at FINAL, that
 * `txHash` is exactly ONE Transfer of `amountYocto` from `from` to `to` and that
 * its receipt succeeded on `to`. Anything else is MISMATCH; RPC trouble is
 * UNAVAILABLE (never "verified").
 */
export async function verifyDirectTransfer(input: NearTestnetConfig, ref: { txHash: string; from: string; to: string; amountYocto: string },
  fetcher: Fetch = (url, init) => globalThis.fetch(url, init)): Promise<DirectTransferCheck> {
  if (!HashSchema.safeParse(ref.txHash).success || !AccountIdSchema.safeParse(ref.from).success || !AccountIdSchema.safeParse(ref.to).success ||
    !U128Schema.safeParse(ref.amountYocto).success) return { kind: "MISMATCH" };
  const config = parseConfig({ ...input, contract: null });
  const client = buildClient(config, fetcher, false, () => new Date());
  const network = await client.checkNetwork();
  if (network.error !== null) return { kind: "UNAVAILABLE" };
  const rpc = createRpc(config, fetcher);
  let raw: unknown;
  try {
    raw = await rpc("EXPERIMENTAL_tx_status", { tx_hash: ref.txHash, sender_account_id: ref.from, wait_until: "FINAL" });
  } catch (cause) {
    if (cause instanceof NearClientError && (cause.code === "TRANSACTION_UNKNOWN" || cause.code === "ACCOUNT_NOT_FOUND")) return { kind: "NOT_FOUND" };
    return { kind: "UNAVAILABLE" };
  }
  const parsed = TransferTxSchema.safeParse(raw);
  if (!parsed.success) return { kind: "UNAVAILABLE" };
  const tx = parsed.data;
  const success = (s: unknown) => typeof s === "object" && s !== null && Object.hasOwn(s, "SuccessValue") && (s as { SuccessValue: unknown }).SuccessValue === "";
  const receiptOf = (s: unknown) => typeof s === "object" && s !== null && typeof (s as { SuccessReceiptId?: unknown }).SuccessReceiptId === "string"
    ? (s as { SuccessReceiptId: string }).SuccessReceiptId : null;
  const action = tx.transaction.actions.length === 1 ? tx.transaction.actions[0] : null;
  const deposit = typeof action === "object" && action !== null && Object.keys(action).length === 1
    ? (action as { Transfer?: { deposit?: unknown } }).Transfer?.deposit : undefined;
  const firstId = receiptOf(tx.transaction_outcome.outcome.status);
  const first = tx.receipts_outcome.find((r) => r.id === firstId);
  if (tx.transaction.hash !== ref.txHash || tx.transaction.signer_id !== ref.from || tx.transaction.receiver_id !== ref.to ||
    deposit !== ref.amountYocto || !success(tx.status) || !first || first.outcome.executor_id !== ref.to || !success(first.outcome.status))
    return { kind: "MISMATCH" };
  try {
    const block = BlockSchema.parse(await rpc("block", { block_id: first.block_hash }));
    return { kind: "VERIFIED", blockHash: first.block_hash, blockTimestampNs: block.timestampNs };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
