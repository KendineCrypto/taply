import { z } from "zod";
import { MainnetAccountSchema, MainnetContractIdSchema, MainnetIntentTermsSchema, MAINNET_USDC,
  MAINNET_USDC_ASSET, MAINNET_NATIVE_CAP, MAINNET_USDC_CAP, U128Schema, U64Schema,
  calculateMainnetTermsHash, buildInstantRecipientMessage, parseStrictJson, HashHexSchema, MainnetRequestSchema, type MainnetIntentTerms } from "@taply/shared";
import { createRpc, NearClientError, type Fetch } from "./rpc.js";
import { HashSchema } from "./validation.js";

export const MAINNET_GENESIS_HASH = "EPnLgE7iEq9s7yTkos96M3cWymH5avBAPm3qx3NXqR8H";
export const MAINNET_RPC_URLS = ["https://rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"] as const;
export const MAINNET_EXPLORER = "https://nearblocks.io";
export const MAINNET_VAULT_STORAGE_KEY = "taply.wallet.near-mainnet.disabled.v1";
export const MainnetProfileSchema = z.strictObject({ network: z.literal("near-mainnet"), rpcUrl: z.enum(MAINNET_RPC_URLS),
  rpcProviderId: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  contract: z.strictObject({ accountId: MainnetContractIdSchema, expectedCodeHash: HashSchema }),
  timeoutMs: z.number().int().min(100).max(30000).default(10000),
  maxResponseBytes: z.number().int().min(1024).max(4194304).default(1048576),
}).superRefine((p, ctx) => {
  if (["11111111111111111111111111111111", "963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84", "BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B"].includes(p.contract.expectedCodeHash))
    ctx.addIssue({ code: "custom", message: "UNAPPROVED_CODE_HASH" });
});
export type MainnetProfile = z.input<typeof MainnetProfileSchema>;
export const MainnetContractConfigSchema = z.object({
  schemaVersion: z.literal("taply.contract-config.v1"), contractVersion: z.literal("0.6.0-mainnet"),
  network: z.literal("near-mainnet"), contractId: MainnetContractIdSchema,
  routerAccountId: z.literal("intents.near"), recoveryAccountId: z.literal("kendinecrypto.near"),
  nativeCapYocto: z.literal(MAINNET_NATIVE_CAP), usdcCapBaseUnits: z.literal(MAINNET_USDC_CAP),
  testFaultBuild: z.literal(false), unknownCallbackPolicy: z.literal("IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE"),
  capabilities: z.object({ instantNative: z.literal(true), nep141: z.literal(true), protectedPay: z.literal(false), intentsRouter: z.literal(false) }),
  tokens: z.array(z.strictObject({ accountId: z.literal(MAINNET_USDC), assetId: z.literal(MAINNET_USDC_ASSET), decimals: z.literal(6), symbol: z.literal("USDC") })).length(1),
  protected: z.object({ reviewStatus: z.literal("UNREVIEWED_OWNER_ACCEPTED_CAPPED") }),
  gas: z.object({ createRequest: U64Schema, payInstantNative: U64Schema, callback: U64Schema, ftTransfer: U64Schema, ftOnTransfer: U64Schema }),
}).superRefine((c, ctx) => {
  for (const [key, min] of Object.entries({ createRequest: 30, payInstantNative: 50, callback: 15, ftTransfer: 15, ftOnTransfer: 40 })) {
    const gas = c.gas[key as keyof typeof c.gas];
    if (BigInt(gas) < BigInt(min) * 1000000000000n || BigInt(gas) > 300000000000000n)
      ctx.addIssue({ code: "custom", message: `UNSAFE_GAS_${key}` });
  }
});
export function mainnetConfigProblems(input: unknown, contractId: string): string[] {
  const p = MainnetContractConfigSchema.safeParse(input);
  return !p.success ? p.error.issues.map(i => i.message) : p.data.contractId !== contractId ? ["WRONG_CONTRACT"] : [];
}
const blockSchema = z.object({ header: z.object({ hash: HashSchema, timestamp_nanosec: U64Schema }) });
const accountSchema = z.object({ code_hash: HashSchema });
const callSchema = z.object({ result: z.array(z.number().int().min(0).max(255)) });
const storageSchema = z.strictObject({ total: U128Schema, available: U128Schema }).nullable();

/** Mainnet-only reader. Each read verifies genesis and code at the same final block.
 * No signing, vault, network switching or provider fallback is exposed. */
export function createMainnetReader(input: MainnetProfile, fetcher: Fetch = (url, init) => globalThis.fetch(url, init)) {
  const config = MainnetProfileSchema.parse(input);
  const rpc = createRpc(config, fetcher);
  async function anchor() {
    const status = z.object({ chain_id: z.literal("mainnet"), sync_info: z.object({ syncing: z.literal(false) }) }).safeParse(await rpc("status", []));
    const genesis = blockSchema.parse(await rpc("block", { block_id: 0 }));
    if (!status.success || genesis.header.hash !== MAINNET_GENESIS_HASH) throw new NearClientError("NETWORK_MISMATCH");
    const block = blockSchema.parse(await rpc("block", { finality: "final" }));
    const account = accountSchema.parse(await rpc("query", { request_type: "view_account", account_id: config.contract.accountId, block_id: block.header.hash }));
    if (account.code_hash !== config.contract.expectedCodeHash) throw new NearClientError("CONTRACT_CODE_MISMATCH");
    return block.header;
  }
  async function view(accountId: string, methodName: string, args: Record<string, unknown>) {
    const block = await anchor();
    const bytes = new TextEncoder().encode(JSON.stringify(args));
    const argsBase64 = btoa(String.fromCharCode(...bytes));
    const result = callSchema.parse(await rpc("query", { request_type: "call_function", account_id: accountId,
      method_name: methodName, args_base64: argsBase64, block_id: block.hash }));
    return { data: parseStrictJson(new Uint8Array(result.result)), blockHash: block.hash, timestampNs: block.timestamp_nanosec,
      source: "rpc" as const, finality: "final" as const, network: "near-mainnet" as const, providerId: config.rpcProviderId };
  }
  return Object.freeze({
    async readConfig() { const r = await view(config.contract.accountId, "get_config", {});
      const data = MainnetContractConfigSchema.parse(r.data);
      if (data.contractId !== config.contract.accountId) throw new NearClientError("EVIDENCE_MISMATCH");
      return { ...r, data }; },
    async readRequest(id: string) {
      const r = await view(config.contract.accountId, "get_request", { id: HashHexSchema.parse(id) });
      const data = MainnetRequestSchema.nullable().parse(r.data);
      if (data && (data.terms.id !== id || data.terms.contractId !== config.contract.accountId)) throw new NearClientError("EVIDENCE_MISMATCH");
      return { ...r, data }; },
    async quoteCreateRequest(terms: MainnetIntentTerms) {
      const t = checkedTerms(config, terms);
      return view(config.contract.accountId, "quote_create_request", { terms: t }); },
    async readUsdcBalance(accountId: string) { const r = await view(MAINNET_USDC, "ft_balance_of", { account_id: MainnetAccountSchema.parse(accountId) }); return { ...r, data: U128Schema.parse(r.data) }; },
    async readUsdcStorage(accountId: string) { const r = await view(MAINNET_USDC, "storage_balance_of", { account_id: MainnetAccountSchema.parse(accountId) }); return { ...r, data: storageSchema.parse(r.data) }; },
    async readUsdcStorageBounds() { const r = await view(MAINNET_USDC, "storage_balance_bounds", {}); return { ...r, data: z.strictObject({ min: U128Schema, max: U128Schema.nullable() }).parse(r.data) }; },
  });
}
export interface MainnetCall { receiverId: string; methodName: string; args: Record<string, unknown>; gas: string; depositYocto: string }
function checkedTerms(profile: MainnetProfile, terms: MainnetIntentTerms) {
  const p = MainnetProfileSchema.parse(profile); const t = MainnetIntentTermsSchema.parse(terms);
  if (p.contract.accountId !== t.contractId) throw new Error("WRONG_CONTRACT"); return t;
}
/** Builders are unsigned candidates. Caller must obtain fresh final config/request reads and explicit external-wallet approval. */
export function prepareMainnetPayment(input: { profile: MainnetProfile; terms: MainnetIntentTerms; status: string; termsHash: string; signerAccountId: string; observedAtNs: string }): MainnetCall {
  const t = checkedTerms(input.profile, input.terms); const hash = calculateMainnetTermsHash(t);
  MainnetAccountSchema.parse(input.signerAccountId); U64Schema.parse(input.observedAtNs);
  if (input.status !== "OPEN" || input.termsHash !== hash || BigInt(input.observedAtNs) >= BigInt(t.fundingExpiresAtNs) ||
    (t.permittedPayerAccountId !== null && t.permittedPayerAccountId !== input.signerAccountId)) throw new Error("NOT_PAYABLE");
  return t.assetId === "near:native" ? { receiverId: t.contractId, methodName: "pay_instant_native",
    args: { id: t.id, expectedTermsHash: hash }, gas: "50000000000000", depositYocto: t.amountBaseUnits } :
    { receiverId: MAINNET_USDC, methodName: "ft_transfer_call", args: { receiver_id: t.contractId,
      amount: t.amountBaseUnits, msg: buildInstantRecipientMessage(t.id, hash) }, gas: "100000000000000", depositYocto: "1" };
}
export function prepareMainnetTokenStorageDeposit(profile: MainnetProfile, signerAccountId: string, minimum: string): MainnetCall {
  MainnetProfileSchema.parse(profile); MainnetAccountSchema.parse(signerAccountId); U128Schema.parse(minimum);
  if (BigInt(minimum) <= 0n || BigInt(minimum) > 2000000000000000000000n) throw new Error("STORAGE_DEPOSIT_OUT_OF_BOUNDS");
  return { receiverId: MAINNET_USDC, methodName: "storage_deposit", args: { account_id: signerAccountId, registration_only: true }, gas: "30000000000000", depositYocto: minimum };
}
export function prepareMainnetCreateRequest(input: { profile: MainnetProfile; terms: MainnetIntentTerms; signerAccountId: string;
  quote: { requestId: string; termsHash: string; quoteVersion: string; depositYocto: string; gas: string } }): MainnetCall {
  const t = checkedTerms(input.profile, input.terms); const q = input.quote; U128Schema.parse(q.depositYocto); U64Schema.parse(q.gas);
  if (input.signerAccountId !== t.creatorAccountId || q.requestId !== t.id || q.termsHash !== calculateMainnetTermsHash(t) ||
    q.quoteVersion !== "1" || BigInt(q.gas) < 30000000000000n || BigInt(q.gas) > 300000000000000n || BigInt(q.depositYocto) > 10000000000000000000000n)
    throw new Error("INVALID_CREATE_QUOTE");
  return { receiverId: t.contractId, methodName: "create_request", args: { terms: t, quoteVersion: "1" }, gas: q.gas, depositYocto: q.depositYocto };
}
export function prepareMainnetCancelUnfunded(input: { profile: MainnetProfile; terms: MainnetIntentTerms; status: string; signerAccountId: string }): MainnetCall {
  const t = checkedTerms(input.profile, input.terms);
  if (input.status !== "OPEN" || input.signerAccountId !== t.creatorAccountId) throw new Error("NOT_CANCELLABLE");
  return { receiverId: t.contractId, methodName: "cancel_unfunded", args: { id: t.id, expectedTermsHash: calculateMainnetTermsHash(t) }, gas: "15000000000000", depositYocto: "1" };
}
export function prepareMainnetRetryPayout(input: { profile: MainnetProfile; terms: MainnetIntentTerms; status: string; signerAccountId: string; operationNonce: string }): MainnetCall {
  const t = checkedTerms(input.profile, input.terms); U64Schema.parse(input.operationNonce);
  if (input.status !== "PAYOUT_FAILED_RECOVERABLE" || input.signerAccountId !== t.creatorAccountId || input.operationNonce === "0") throw new Error("NO_RECORDED_TRANSFER_FAILURE");
  return { receiverId: t.contractId, methodName: "retry_native_transfer", args: { id: t.id, expectedOperationNonce: input.operationNonce }, gas: "50000000000000", depositYocto: "1" };
}
/** Deliberate hard gate: never import/unlock a Testnet mnemonic vault for mainnet. */
export function openMainnetVault(): never { throw new Error("MAINNET_INTERNAL_WALLET_DISABLED_USE_EXTERNAL_WALLET"); }
