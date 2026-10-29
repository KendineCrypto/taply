import { z } from "zod";
import { API_VERSION, AccountIdSchema, HashHexSchema, NetworkSchema, PositiveU64Schema,
  SessionIdSchema, U64Schema, UtcDateTimeSchema, isWellFormedUnicode } from "./primitives.js";
import { ChainHashSchema } from "./payments.js";

export const API_PREFIX = "/api/v1" as const;
export const DYNAMIC_RESPONSE_HEADERS = Object.freeze({ "Cache-Control": "no-store" });
export const SESSION_STATES = ["DRAFT", "OPEN", "PAIRED", "REVIEWED", "EXPIRED", "CLOSED"] as const;
export const SessionStateSchema = z.enum(SESSION_STATES);
export const ComparisonCodeSchema = z.string().regex(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);

export const HandshakeSessionSchema = z.strictObject({
  id: SessionIdSchema,
  nonce: HashHexSchema,
  expiresAtNs: PositiveU64Schema,
  state: SessionStateSchema,
  merchantAccountId: AccountIdSchema,
  payerAccountId: AccountIdSchema.nullable(),
  intentId: HashHexSchema.nullable(),
  termsHash: HashHexSchema.nullable(),
  comparisonCode: ComparisonCodeSchema.nullable(),
  presence: z.strictObject({ merchant: z.boolean(), payer: z.boolean() }),
}).superRefine((session, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const bound = [session.intentId, session.termsHash, session.comparisonCode].filter((v) => v !== null).length;
  if (bound !== 0 && bound !== 3) issue("Session binding fields must appear together");
  if (session.state === "DRAFT" && (bound !== 0 || session.payerAccountId !== null)) issue("Draft is not yet bound/joined");
  if (["OPEN", "PAIRED", "REVIEWED"].includes(session.state) && bound !== 3) issue("Live session must bind one request");
  if (["PAIRED", "REVIEWED"].includes(session.state) && session.payerAccountId === null) issue("Paired/reviewed session requires authenticated payer");
});

export const SessionReviewSchema = z.strictObject({ termsHash: HashHexSchema });
export const SessionEventSchema = z.strictObject({
  schemaVersion: z.literal("taply.events.v1"),
  eventId: U64Schema,
  sessionId: SessionIdSchema,
  type: z.enum(["session.bound", "session.joined", "session.presence", "session.reviewed", "payment.changed",
    "session.expired", "session.closed", "stream.reset"]),
  emittedAt: UtcDateTimeSchema,
  intentId: HashHexSchema.nullable(),
  intentRevisionHint: U64Schema.nullable(),
}).superRefine((event, ctx) => {
  if ((event.type === "payment.changed" || event.type === "session.bound" || event.type === "session.reviewed") && event.intentId === null)
    ctx.addIssue({ code: "custom", message: "Bound event requires intent ID" });
});

function base64Bytes(length: number) {
  return z.string().max(Math.ceil(length / 3) * 4).refine((value) => {
    try { const bytes = atob(value); return bytes.length === length && btoa(bytes) === value; }
    catch { return false; }
  }, `Expected canonical base64 encoding of ${length} bytes`);
}

export const MerchantProfileSchema = z.strictObject({
  merchantId: z.string().max(77),
  slug: AccountIdSchema,
  accountId: AccountIdSchema,
  displayName: z.string().min(1).max(100).refine(isWellFormedUnicode),
  profileVersion: PositiveU64Schema,
  issuedAtNs: U64Schema,
  expiresAtNs: U64Schema,
  binding: z.strictObject({
    standard: z.literal("NEP-413"),
    message: z.string().min(1).max(4096).refine(isWellFormedUnicode),
    nonceBase64: base64Bytes(32),
    recipient: z.url({ protocol: /^https?$/ }),
    publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    signatureBase64: base64Bytes(64),
  }),
}).superRefine((profile, ctx) => {
  if (profile.slug !== profile.accountId || profile.merchantId !== `near-testnet:${profile.accountId}`)
    ctx.addIssue({ code: "custom", message: "Merchant slug/identity must equal receiving account" });
  if (U64Schema.safeParse(profile.issuedAtNs).success && U64Schema.safeParse(profile.expiresAtNs).success
    && BigInt(profile.expiresAtNs) <= BigInt(profile.issuedAtNs))
    ctx.addIssue({ code: "custom", message: "Profile expiry must follow issuance" });
});

export const ERROR_CODES = [
  "INVALID_ARGUMENT", "INVALID_ACCOUNT", "INVALID_AMOUNT", "INVALID_DURATION", "INVALID_EXPIRY",
  "WRONG_NETWORK", "UNSUPPORTED_ASSET", "UNSUPPORTED_MODE", "INVALID_DEPOSIT", "INSUFFICIENT_PREPAID_GAS",
  "AUTH_REQUIRED", "AUTH_EXPIRED", "AUTH_SIGNATURE_INVALID", "AUTH_CHALLENGE_EXPIRED", "AUTH_CHALLENGE_USED",
  "NOT_AUTHORIZED", "PAYER_MISMATCH", "MERCHANT_BINDING_INVALID", "UNSUPPORTED_CALLER", "CSRF_REJECTED",
  "REQUEST_NOT_FOUND", "SESSION_NOT_FOUND", "MERCHANT_NOT_FOUND", "IDEMPOTENCY_CONFLICT", "REQUEST_ID_CONFLICT",
  "TERMS_MISMATCH", "REQUEST_EXPIRED", "REQUEST_NOT_OPEN", "REQUEST_ALREADY_FUNDED", "REQUEST_ALREADY_SETTLED",
  "CANCEL_WINDOW_CLOSED", "WINDOW_STILL_OPEN", "OPERATION_IN_FLIGHT", "OPERATION_NONCE_MISMATCH", "OPERATION_NOT_RETRYABLE",
  "RECEIPT_NOT_FINAL", "SESSION_MISMATCH", "SESSION_ALREADY_BOUND", "SESSION_ALREADY_JOINED", "STORAGE_QUOTE_CHANGED",
  "SESSION_EXPIRED", "JOIN_TOKEN_EXPIRED", "JOIN_TOKEN_USED", "RATE_LIMITED", "RPC_UNAVAILABLE", "INDEX_UNAVAILABLE",
  "VERIFICATION_UNAVAILABLE", "CONTRACT_UNAVAILABLE", "TRANSFER_LIQUIDITY_UNAVAILABLE",
  "WALLET_NOT_READY", "USER_REJECTED", "INSUFFICIENT_BALANCE", "INSUFFICIENT_GAS",
  "RPC_TIMEOUT_UNKNOWN_STATUS", "CALLBACK_FAILED", "RECONCILIATION_REQUIRED",
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export const RetryActionSchema = z.enum(["NONE", "REAUTHENTICATE", "REFETCH", "WAIT_AND_RECONCILE", "RETRY_SAME_OPERATION"]);
export const ApiErrorSchema = z.strictObject({
  schemaVersion: z.literal(API_VERSION),
  error: z.strictObject({
    code: ErrorCodeSchema,
    messageKey: z.string().regex(/^errors\.[A-Z_]+$/),
    requestId: z.string().min(1).max(128),
    retryAction: RetryActionSchema,
    retryAfterMs: z.number().int().min(0).max(86_400_000).nullable(),
    details: z.record(z.string().max(64), z.string().max(256))
      .refine((value) => Object.keys(value).length <= 16, "Too many diagnostic details"),
  }),
}).superRefine(({ error }, ctx) => {
  if (error.messageKey !== `errors.${error.code}`) ctx.addIssue({ code: "custom", message: "Translation key must match stable code" });
  if (["RPC_TIMEOUT_UNKNOWN_STATUS", "CALLBACK_FAILED", "RECONCILIATION_REQUIRED", "OPERATION_IN_FLIGHT"].includes(error.code)
    && error.retryAction !== "WAIT_AND_RECONCILE") ctx.addIssue({ code: "custom", message: "Unknown/in-flight outcome cannot trigger payment retry" });
});

export const TransactionHintSchema = z.strictObject({
  txHash: ChainHashSchema,
  signerAccountId: AccountIdSchema,
  purpose: z.enum(["CREATE_REQUEST", "FUND", "CANCEL_UNFUNDED", "CANCEL_PROTECTED", "RELEASE_PROTECTED", "RETRY_NATIVE_TRANSFER"]),
});

export function createCursorPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.strictObject({ items: z.array(itemSchema).max(100), nextCursor: z.string().min(1).max(512).nullable() });
}
export type CursorPage<T> = { items: T[]; nextCursor: string | null };

// Phase 0 exposes no working network or financial capability. Do not replace null
// deployment/budgets with fixture IDs or unmeasured estimates to enable a UI.
export const PHASE_0_CAPABILITIES = Object.freeze({
  instantPay: false, protectedPay: false, handshake: false, socialLogin: false,
  embeddedWallet: false, sponsoredGas: false, nep141: false, milestonePay: false,
  splitPay: false, recurringRequests: false, contacts: false,
} as const);
export const PHASE_0_CONFIG = Object.freeze({
  schemaVersion: API_VERSION,
  network: NetworkSchema.value,
  deployment: null,
  gas: null,
  storage: null,
  capabilities: PHASE_0_CAPABILITIES,
});

export type SessionState = z.infer<typeof SessionStateSchema>;
export type HandshakeSession = z.infer<typeof HandshakeSessionSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;
export type MerchantProfile = z.infer<typeof MerchantProfileSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type RetryAction = z.infer<typeof RetryActionSchema>;
export type TransactionHint = z.infer<typeof TransactionHintSchema>;
