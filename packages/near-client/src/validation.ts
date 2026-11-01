import { z } from "zod";
import { isLosslessNumber, parse, stringify } from "lossless-json";
import { visit } from "jsonc-parser";
import { AccountIdSchema, U64Schema, U128Schema, isWellFormedUnicode } from "@taply/shared";

// Enforce the decoded 32-byte hash length too; shared intentionally validates syntax only.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const HashSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).refine((value) => {
  let decoded = 0n;
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = 0;
  for (let remaining = decoded; remaining > 0n; remaining >>= 8n) bytes++;
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
});
export const RpcU64Schema = z.unknown().transform((value, ctx) => {
  if (!isLosslessNumber(value)) {
    ctx.addIssue({ code: "custom", message: "Expected lossless RPC integer" });
    return z.NEVER;
  }
  return value.toString();
}).pipe(U64Schema);
export const BlockSchema = z.object({ header: z.object({
  hash: HashSchema, height: RpcU64Schema, timestamp_nanosec: U64Schema,
}) }).transform(({ header }) => ({ hash: header.hash, height: header.height, timestampNs: header.timestamp_nanosec }));
export const AccountSchema = z.object({
  amount: U128Schema, locked: U128Schema, storage_usage: RpcU64Schema, code_hash: HashSchema,
  block_hash: HashSchema, block_height: RpcU64Schema,
});
const RpcByteSchema = z.unknown().transform((value, ctx) => {
  const text = isLosslessNumber(value) ? value.toString() : "";
  if (!/^(0|[1-9][0-9]{0,2})$/.test(text) || Number(text) > 255) {
    ctx.addIssue({ code: "custom", message: "Expected a byte" });
    return z.NEVER;
  }
  return Number(text);
});
/** `query` call_function result: raw return bytes, anchored to one block. */
export const CallResultSchema = z.strictObject({
  result: z.array(RpcByteSchema).max(65_536),
  logs: z.array(z.string()).max(256),
  block_hash: HashSchema,
  block_height: RpcU64Schema,
});
export const TransactionRefSchema = z.strictObject({ transactionHash: HashSchema, signerAccountId: AccountIdSchema });
export const ReceiptRefSchema = TransactionRefSchema.extend({ receiptId: HashSchema });

export function parseRpcJson(text: string): unknown {
  let depth = 0;
  const checkUnicode = (value: unknown) => {
    if (typeof value === "string" && !isWellFormedUnicode(value)) throw new Error("Invalid Unicode");
  };
  const begin = () => { if (++depth > 48) throw new Error("JSON too deep"); };
  const end = () => { depth--; };
  visit(text, {
    onObjectBegin: begin, onArrayBegin: begin, onObjectEnd: end, onArrayEnd: end,
    onObjectProperty: checkUnicode, onLiteralValue: checkUnicode,
    onError: () => { throw new Error("Invalid JSON"); },
  }, { disallowComments: true, allowTrailingComma: false });
  return parse(text, undefined, { onDuplicateKey: () => { throw new Error("Duplicate key"); } });
}

export function losslessStringify(value: unknown): string {
  const result = stringify(value);
  if (result === undefined) throw new Error("Cannot serialize JSON");
  return result;
}

/**
 * JSON for schema-based RPC consumers: safe integer tokens become numbers;
 * larger tokens stay exact as bigint. Never coerce numeric tokens into strings
 * (amount schemas must still reject a number where the wire requires a string).
 * A consumer's numeric schema must reject bigint for fields it actually uses.
 */
export function parseRpcJsonWithIntegers(text: string): unknown {
  const convert = (value: unknown): unknown => {
    if (isLosslessNumber(value)) {
      const token = value.toString();
      if (!/^-?(0|[1-9][0-9]*)$/.test(token)) throw new Error("Expected RPC integer");
      const integer = BigInt(token);
      return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(integer) : integer;
    }
    if (Array.isArray(value)) return value.map(convert);
    if (typeof value === "object" && value !== null)
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)]));
    return value;
  };
  return convert(parseRpcJson(text));
}
