import { z } from "zod";

export const API_VERSION = "taply.api.v1" as const;
export const INTENT_VERSION = "taply.intent.v1" as const;
export const CONTRACT_EVENT_VERSION = "0.4.0" as const;
export const U64_MAX = 18_446_744_073_709_551_615n;
export const U128_MAX = 340_282_366_920_938_463_463_374_607_431_768_211_455n;
export const MIN_CANCEL_DURATION_NS = 60_000_000_000n;
export const MAX_CANCEL_DURATION_NS = 3_600_000_000_000n;
export const DEFAULT_CANCEL_DURATION_NS = "60000000000";
export const DEFAULT_FUNDING_LIFETIME_NS = "900000000000";
export const MAX_FUNDING_LIFETIME_NS = 86_400_000_000_000n;

export function isWellFormedUnicode(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

function decimal(max: bigint) {
  // Check length/lexical form before BigInt: hostile inputs must stay bounded.
  return z.string().max(max.toString().length).regex(/^(0|[1-9][0-9]*)$/)
    .refine((v) => /^(0|[1-9][0-9]*)$/.test(v) && v.length <= max.toString().length && BigInt(v) <= max,
      "Out of integer range or noncanonical decimal");
}

export const U64Schema = decimal(U64_MAX);
export const U128Schema = decimal(U128_MAX);
export const PositiveU64Schema = U64Schema.refine((v) => v !== "0", "Must be positive");
export const AmountSchema = U128Schema.refine((v) => v !== "0", "Must be positive");
export const HashHexSchema = z.string().regex(/^[0-9a-f]{64}$/);
// NEAR account syntax, including implicit IDs. Syntax never proves network or existence.
export const AccountIdSchema = z.string().min(2).max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const NetworkSchema = z.literal("near-testnet");
export const AssetIdSchema = z.literal("near:native");
export const PayModeSchema = z.enum(["instant", "protected"]);
export const SessionIdSchema = z.string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const UtcDateTimeSchema = z.iso.datetime({ offset: false });
export const MemoSchema = z.string().max(256).refine(isWellFormedUnicode, "Invalid Unicode")
  .refine((v) => new TextEncoder().encode(v).length <= 256, "Memo exceeds 256 UTF-8 bytes");

export type U64 = z.infer<typeof U64Schema>;
export type U128 = z.infer<typeof U128Schema>;
export type AccountId = z.infer<typeof AccountIdSchema>;
export type HashHex = z.infer<typeof HashHexSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type PayMode = z.infer<typeof PayModeSchema>;
