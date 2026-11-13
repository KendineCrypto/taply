import { z } from "zod";
import {
  MainnetAccountSchema, MainnetEscrowAccountSchema, MAINNET_USDC, MAINNET_USDC_ASSET, MAINNET_NATIVE_CAP, MAINNET_USDC_CAP,
  ContractMethodArgs, MainnetEscrowRequestSchema, MainnetEscrowTermsSchema, MAX_CANCEL_DURATION_NS,
  MIN_CANCEL_DURATION_NS, PositiveU64Schema, U128Schema, U64Schema, calculateMainnetEscrowTermsHash,
  type MainnetEscrowRequest, type MainnetEscrowTerms,
} from "@taply/shared";
import { parseStrictJson } from "@taply/shared";
import { CreateQuoteSchema, type CreateQuote } from "./contract.js";
import { NearClientError, type Fetch } from "./rpc.js";
import { AccountSchema, CallResultSchema, HashSchema } from "./validation.js";
import { mainnetTransport, MainnetReadProfileSchema } from './mainnet-network.js';

/**
 * Protected Pay (G3) CANDIDATE contract seam: contracts/payments-protected.
 *
 * UNREVIEWED. Nothing here is wired to a default deployment. The pilot G1
 * contract is refused outright: it cannot hold escrow. Every builder repeats
 * the contract's own guards so a wallet is never asked to sign a call the
 * contract would reject, but the contract re-checks everything at execution
 * time and chain time decides cancel vs release, not these builders.
 */
export const MAINNET_ESCROW_VERSION = "0.7.0-mainnet";
export const MAINNET_ESCROW_CONSENT_VERSION = "taply.protected-consent.v1";

export const MainnetEscrowConfigSchema = z.strictObject({
  schemaVersion: z.literal("taply.contract-config.v1"),
  contractVersion: z.literal(MAINNET_ESCROW_VERSION),
  network: z.literal("near-mainnet"),
  contractId: MainnetEscrowAccountSchema,
  nativeCapYocto: z.literal(MAINNET_NATIVE_CAP), usdcCapBaseUnits: z.literal(MAINNET_USDC_CAP),
  intentVersion: z.literal("taply.intent.v1"),
  eventVersion: z.literal("0.4.0"),
  capabilities: z.strictObject({
    instantNative: z.literal(true), protectedPay: z.literal(true), handshake: z.literal(false), intentsRouter: z.literal(false),
    merchantProfiles: z.literal(false), nep141: z.boolean(), sponsoredGas: z.literal(false),
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
    assetId: z.literal(MAINNET_USDC_ASSET), accountId: z.literal(MAINNET_USDC),
    decimals: z.literal(6), symbol: z.literal('USDC'),
  })).max(1),
  protected: z.strictObject({
    consentVersion: z.literal(MAINNET_ESCROW_CONSENT_VERSION),
    minCancelDurationNs: z.literal(MIN_CANCEL_DURATION_NS.toString()),
    maxCancelDurationNs: z.literal(MAX_CANCEL_DURATION_NS.toString()),
    cutoffRule: z.literal("CANCEL_IF_BLOCK_TIME_LT_CUTOFF_RELEASE_IF_GTE"),
    reviewStatus: z.enum(["UNREVIEWED_NOT_FOR_REAL_FUNDS"]),
  }),
  storageRefundPolicy: z.literal("PERMANENT_RECORD_NO_WITHDRAWAL"),
  unknownCallbackPolicy: z.literal("IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE"),
  testFaultBuild: z.literal(false),
});
export type MainnetEscrowConfig = z.infer<typeof MainnetEscrowConfigSchema>;

/** Minimum gas the candidate enforces (contracts/payments-protected/src/lib.rs). */
export const MAINNET_ESCROW_MINIMUM_GAS = Object.freeze({
  createRequest: 30_000_000_000_000n,
  fundProtectedNative: 20_000_000_000_000n,
  cancelProtected: 50_000_000_000_000n,
  releaseProtected: 50_000_000_000_000n,
  retryNativeTransfer: 50_000_000_000_000n,
});

export type MainnetEscrowConfigProblem =
  | "PILOT_CANNOT_HOLD_ESCROW" | "CONTRACT_ID_MISMATCH" | "TEST_FAULT_BUILD" | "PROTECTED_DISABLED"
  | "UNSUPPORTED_CAPABILITY" | "UNSUPPORTED_QUOTE_VERSION" | "GAS_BELOW_MINIMUM" | "UNREVIEWED_CANDIDATE";

/**
 * Everything that must hold before a frontend may offer Protected Pay. While the
 * candidate is unreviewed the list ALWAYS contains UNREVIEWED_CANDIDATE; only a
 * protected QA build may choose to accept that single problem, and never for
 * real funds.
 */
export function mainnetEscrowConfigProblems(config: MainnetEscrowConfig, expectedContractId: string): MainnetEscrowConfigProblem[] {
  const problems: MainnetEscrowConfigProblem[] = [];
  if (!MainnetEscrowAccountSchema.safeParse(expectedContractId).success) problems.push("PILOT_CANNOT_HOLD_ESCROW");
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
  if (BigInt(gas.createRequest) < MAINNET_ESCROW_MINIMUM_GAS.createRequest
    || BigInt(gas.fundProtectedNative) < MAINNET_ESCROW_MINIMUM_GAS.fundProtectedNative
    || BigInt(gas.cancelProtected) < MAINNET_ESCROW_MINIMUM_GAS.cancelProtected
    || BigInt(gas.releaseProtected) < MAINNET_ESCROW_MINIMUM_GAS.releaseProtected
    || BigInt(gas.retryNativeTransfer) < MAINNET_ESCROW_MINIMUM_GAS.retryNativeTransfer) problems.push("GAS_BELOW_MINIMUM");
  if (config.protected.reviewStatus === "UNREVIEWED_NOT_FOR_REAL_FUNDS") problems.push("UNREVIEWED_CANDIDATE");
  return problems;
}

export interface PreparedMainnetEscrowCall {
  receiverId: string;
  methodName: "create_request" | "fund_protected_native" | "cancel_protected" | "release_protected" | "retry_native_transfer";
  args: Record<string, unknown>;
  gas: string;
  depositYocto: string;
}

function refuse(): never {
  throw new NearClientError("INVALID_ARGUMENT", false);
}
function checkedConfig(input: MainnetEscrowConfig, contractId: string) {
  const c = MainnetEscrowConfigSchema.parse(input);
  if (mainnetEscrowConfigProblems(c,contractId).some(p=>p!=='UNREVIEWED_CANDIDATE')) refuse();
  if (Object.values(c.gas).some(g=>g!==undefined && BigInt(g)>100000000000000n) || BigInt(c.gas.callback)<15000000000000n ||
    c.gas.ftOnTransfer===undefined || BigInt(c.gas.ftOnTransfer)<40000000000000n || c.gas.ftTransfer===undefined || BigInt(c.gas.ftTransfer)<15000000000000n) refuse();
  return c;
}
function assetAllowed(c: MainnetEscrowConfig, asset: string) {
  return asset==='near:native' || (c.capabilities.nep141 && c.tokens.some(t=>t.assetId===asset));
}

function protectedTerms(contractId: string, terms: MainnetEscrowTerms): MainnetEscrowTerms {
  MainnetEscrowAccountSchema.parse(contractId);
  const parsed = MainnetEscrowTermsSchema.safeParse(terms);
  if (!parsed.success) refuse();
  const value = parsed.data;
  // Candidate: native Protected only, no merchant/session binding.
  if (value.contractId !== contractId || value.mode !== "protected" || value.cancelDurationNs === null
    || value.merchantAccountId !== null || value.sessionBinding !== null) refuse();
  return value;
}

function request(contractId: string, input: MainnetEscrowRequest): MainnetEscrowRequest {
  const parsed = MainnetEscrowRequestSchema.safeParse(input);
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
export function prepareMainnetCreateProtectedRequest(input: {
  contractId: string; config: MainnetEscrowConfig; terms: MainnetEscrowTerms; quote: CreateQuote; signerAccountId: string;
}): PreparedMainnetEscrowCall {
  checkedConfig(input.config, input.contractId); MainnetAccountSchema.parse(input.signerAccountId);
  const terms = protectedTerms(input.contractId, input.terms);
  if (!assetAllowed(input.config, terms.assetId)) refuse();
  const quote = CreateQuoteSchema.safeParse(input.quote);
  if (!quote.success) refuse();
  const { requestId, termsHash, quoteVersion, depositYocto, gas } = quote.data;
  if (input.signerAccountId !== terms.creatorAccountId) refuse();
  if (requestId !== terms.id || termsHash !== calculateMainnetEscrowTermsHash(terms) || quoteVersion !== input.config.quoteVersion) refuse();
  if (BigInt(gas) < BigInt(input.config.gas.createRequest)) refuse();
  if (BigInt(gas) > 100000000000000n || BigInt(depositYocto) > 10000000000000000000000n) refuse();
  return { receiverId: input.contractId, methodName: "create_request", gas, depositYocto,
    args: { terms, quoteVersion } };
}

/**
 * Payer consent + exact principal. `acceptedCancelDurationNs` is what the
 * consent screen SHOWED; it must equal the signed terms or nothing is built.
 */
export function prepareMainnetFundProtectedNative(input: {
  contractId: string; config: MainnetEscrowConfig; request: MainnetEscrowRequest; signerAccountId: string;
  observedAtNs: string; acceptedCancelDurationNs: string;
}): PreparedMainnetEscrowCall {
  MainnetAccountSchema.parse(input.signerAccountId);
  checkedConfig(input.config, input.contractId);
  const r = request(input.contractId, input.request);
  const terms = r.terms;
  if (terms.assetId !== "near:native") refuse();
  if (r.status !== "OPEN" || observed(input.observedAtNs) >= BigInt(terms.fundingExpiresAtNs)) refuse();
  if (terms.permittedPayerAccountId !== null && terms.permittedPayerAccountId !== input.signerAccountId) refuse();
  if (input.acceptedCancelDurationNs !== terms.cancelDurationNs) refuse();
  return { receiverId: input.contractId, methodName: "fund_protected_native", gas: input.config.gas.fundProtectedNative,
    depositYocto: terms.amountBaseUnits,
    args: checkedArgs("fund_protected_native", { id: terms.id, expectedTermsHash: r.termsHash,
      acceptedCancelDurationNs: terms.cancelDurationNs, consentVersion: MAINNET_ESCROW_CONSENT_VERSION }) };
}

/**
 * Payer-only refund request while the observed final block is before the
 * cutoff. Inclusion before the cutoff is NOT guaranteed by building this.
 */
export function prepareMainnetCancelProtected(input: {
  contractId: string; config: MainnetEscrowConfig; request: MainnetEscrowRequest; signerAccountId: string; observedAtNs: string;
}): PreparedMainnetEscrowCall {
  MainnetAccountSchema.parse(input.signerAccountId);
  checkedConfig(input.config, input.contractId);
  const r = request(input.contractId, input.request);
  if (r.status !== "LOCKED" || r.cancelUntilNs === null || r.payerAccountId !== input.signerAccountId) refuse();
  if (observed(input.observedAtNs) >= BigInt(r.cancelUntilNs)) refuse();
  return { receiverId: input.contractId, methodName: "cancel_protected", gas: input.config.gas.cancelProtected,
    depositYocto: "1", args: checkedArgs("cancel_protected", { id: r.terms.id, expectedTermsHash: r.termsHash }) };
}

/** Anyone may release once a final block at/after the cutoff has been observed. */
export function prepareMainnetReleaseProtected(input: {
  contractId: string; config: MainnetEscrowConfig; request: MainnetEscrowRequest; observedAtNs: string;
}): PreparedMainnetEscrowCall {
  checkedConfig(input.config, input.contractId);
  const r = request(input.contractId, input.request);
  if (r.status !== "LOCKED" || r.cancelUntilNs === null) refuse();
  if (observed(input.observedAtNs) < BigInt(r.cancelUntilNs)) refuse();
  return { receiverId: input.contractId, methodName: "release_protected", gas: input.config.gas.releaseProtected,
    depositYocto: "1", args: checkedArgs("release_protected", { id: r.terms.id }) };
}

/** Beneficiary-only retry of a RECORDED refund/release failure: same branch, same nonce. */
export function prepareMainnetRetryProtectedTransfer(input: {
  contractId: string; config: MainnetEscrowConfig; request: MainnetEscrowRequest; signerAccountId: string;
}): PreparedMainnetEscrowCall {
  MainnetAccountSchema.parse(input.signerAccountId);
  checkedConfig(input.config, input.contractId);
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

export function prepareMainnetProtectedTokenFunding(input: { config:MainnetEscrowConfig; request:MainnetEscrowRequest;
  signerAccountId:string; observedAtNs:string; acceptedCancelDurationNs:string }) {
  const c=checkedConfig(input.config,input.request.terms.contractId), r=request(c.contractId,input.request);
  MainnetAccountSchema.parse(input.signerAccountId);
  if (input.signerAccountId==='intents.near' || !assetAllowed(c,r.terms.assetId) || r.terms.assetId!==MAINNET_USDC_ASSET ||
    r.status!=='OPEN' || observed(input.observedAtNs)>=BigInt(r.terms.fundingExpiresAtNs) ||
    (r.terms.permittedPayerAccountId!==null && r.terms.permittedPayerAccountId!==input.signerAccountId) ||
    input.acceptedCancelDurationNs!==r.terms.cancelDurationNs) refuse();
  return {receiverId:MAINNET_USDC,methodName:'ft_transfer_call' as const,gas:'100000000000000',depositYocto:'1',
    args:{receiver_id:c.contractId,amount:r.terms.amountBaseUnits,msg:JSON.stringify({id:r.terms.id,expectedTermsHash:r.termsHash,
      action:'fund_protected',acceptedCancelDurationNs:r.terms.cancelDurationNs,consentVersion:MAINNET_ESCROW_CONSENT_VERSION})}};
}

export const MainnetEscrowProfileSchema = MainnetReadProfileSchema.extend({contract:z.strictObject({accountId:MainnetEscrowAccountSchema,expectedCodeHash:HashSchema})});
export type MainnetEscrowProfile = z.input<typeof MainnetEscrowProfileSchema>;
export function createMainnetEscrowReader(input:MainnetEscrowProfile, fetcher:Fetch=(url,init)=>globalThis.fetch(url,init)) {
  const {contract,...network}=MainnetEscrowProfileSchema.parse(input), {rpc,finalBlock}=mainnetTransport(network,fetcher);
  async function view(method:string,args:object) {
    const block=await finalBlock();
    const account=AccountSchema.parse(await rpc('query',{request_type:'view_account',account_id:contract.accountId,block_id:block.hash}));
    if (account.block_hash!==block.hash || account.code_hash!==contract.expectedCodeHash) throw new NearClientError('CONTRACT_CODE_MISMATCH');
    async function call(method_name:string,parameters:object) {
      const bytes=new TextEncoder().encode(JSON.stringify(parameters));
      const result=CallResultSchema.parse(await rpc('query',{request_type:'call_function',account_id:contract.accountId,block_id:block.hash,
        method_name,args_base64:btoa(String.fromCharCode(...bytes))}));
      if(result.block_hash!==block.hash) throw new NearClientError('EVIDENCE_MISMATCH');
      return parseStrictJson(new Uint8Array(result.result));
    }
    const config=checkedConfig(MainnetEscrowConfigSchema.parse(await call('get_config',{})),contract.accountId);
    return {data:method==='get_config'?config:await call(method,args),config,blockHash:block.hash,timestampNs:block.timestampNs,
      network:'near-mainnet' as const,finality:'final' as const,source:'rpc' as const};
  }
  return Object.freeze({async readConfig(){const r=await view('get_config',{});return {...r,data:r.config};},
    async readRequest(id:string){
      if(!/^[a-f0-9]{64}$/.test(id)) refuse();
      const r=await view('get_request',{id}), data=MainnetEscrowRequestSchema.nullable().parse(r.data);
      if(data && (data.terms.id!==id || data.terms.contractId!==contract.accountId ||
        [data.createdAtNs,data.fundedAtNs,data.latestOperation?.startedAtNs,data.latestOperation?.resolvedAtNs].some(t=>t!=null && BigInt(t)>BigInt(r.timestampNs))))
        throw new NearClientError('EVIDENCE_MISMATCH');
      return {...r,data};
    },
    async quoteCreateRequest(terms:MainnetEscrowTerms){
      const t=protectedTerms(contract.accountId,terms), r=await view('quote_create_request',{terms:t}), data=CreateQuoteSchema.parse(r.data);
      if(data.requestId!==t.id || data.termsHash!==calculateMainnetEscrowTermsHash(t)) throw new NearClientError('EVIDENCE_MISMATCH');
      return {...r,data};
    }});
}

