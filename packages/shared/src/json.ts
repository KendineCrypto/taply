import canonicalize from "canonicalize";
import { visit } from "jsonc-parser";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { isWellFormedUnicode } from "./primitives.js";

export const MAX_PROTOCOL_JSON_BYTES = 65_536;
export const MAX_PROTOCOL_JSON_DEPTH = 32;

/** Use BEFORE ordinary JSON.parse/body middleware loses duplicate property names. */
export function parseStrictJson(input: string | Uint8Array): unknown {
  if (input.length > MAX_PROTOCOL_JSON_BYTES) throw new Error("JSON_SIZE_LIMIT");
  const text = typeof input === "string" ? input
    : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  if (utf8ToBytes(text).length > MAX_PROTOCOL_JSON_BYTES) throw new Error("JSON_SIZE_LIMIT");
  const keys: Set<string>[] = [];
  let depth = 0;
  const enter = () => {
    if (++depth > MAX_PROTOCOL_JSON_DEPTH) throw new Error("JSON_DEPTH_LIMIT");
  };
  visit(text, {
    onObjectBegin: () => { enter(); keys.push(new Set()); },
    onObjectProperty: (name) => {
      if (!isWellFormedUnicode(name)) throw new Error("JSON_INVALID_UNICODE");
      const current = keys.at(-1);
      if (!current || current.has(name)) throw new Error("JSON_DUPLICATE_KEY");
      current.add(name);
    },
    onObjectEnd: () => { keys.pop(); depth--; },
    onArrayBegin: enter,
    onArrayEnd: () => { depth--; },
    onLiteralValue: (value: unknown) => {
      if (typeof value === "string" && !isWellFormedUnicode(value)) throw new Error("JSON_INVALID_UNICODE");
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("JSON_INVALID_NUMBER");
    },
    onError: () => { throw new Error("JSON_INVALID_SYNTAX"); },
  }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  // JSON.parse remains a second strict grammar check; the visitor is never used as a tolerant parser.
  return JSON.parse(text) as unknown;
}

/** Internal canonicalization of schema-validated protocol values. No normalization. */
export function canonicalJson(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) throw new Error("JSON_NOT_SERIALIZABLE");
  // Protect JCS's Unicode/I-JSON requirements even for in-memory callers.
  parseStrictJson(result);
  return result;
}

export function domainHash(domain: string, payload: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${domain}\n${payload}`)));
}
