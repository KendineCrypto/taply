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
