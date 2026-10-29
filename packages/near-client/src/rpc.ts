import { z } from "zod";
import { isLosslessNumber } from "lossless-json";
import { AccountIdSchema } from "@taply/shared";
import { HashSchema, parseRpcJson } from "./validation.js";
import type { NearTestnetConfig, RpcErrorCode, RpcReadError } from "./types.js";

// Official public Testnet genesis. Endpoint identity is checked on every public read.
export const TESTNET_GENESIS_HASH = "FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b";
const ConfigSchema = z.strictObject({
  network: z.literal("near-testnet"),
  rpcUrl: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }),
  rpcProviderId: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  contract: z.strictObject({ accountId: AccountIdSchema, expectedCodeHash: HashSchema }).nullable(),
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
  maxResponseBytes: z.number().int().min(1024).max(4_194_304).default(1_048_576),
});
export type Config = z.infer<typeof ConfigSchema>;
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;
export class NearClientError extends Error {
  readonly code: RpcErrorCode;
  readonly rpcAvailable: boolean;
  constructor(code: RpcErrorCode, rpcAvailable = true) {
    super(`nearClient.errors.${code}`);
    this.name = "NearClientError";
    this.code = code;
    this.rpcAvailable = rpcAvailable;
  }
}
export function parseConfig(input: NearTestnetConfig): Config {
  const parsed = ConfigSchema.safeParse(input);
  if (!parsed.success) throw new NearClientError("INVALID_CONFIG", false);
  return parsed.data;
}
export function publicError(error: NearClientError, providerId: string): RpcReadError {
  const wait = ["RPC_TIMEOUT", "TRANSACTION_UNKNOWN", "EVIDENCE_INCOMPLETE"].includes(error.code);
  const retry = ["RPC_UNAVAILABLE", "RPC_RATE_LIMITED", "RPC_HTTP_ERROR", "RPC_ERROR", "SHARD_UNAVAILABLE", "NODE_SYNCING"].includes(error.code);
  return { code: error.code, messageKey: `nearClient.errors.${error.code}`, providerId,
    retry: wait ? "WAIT_AND_RECONCILE" : retry ? "READ_ONLY" : "NONE" };
}
type Method = "status" | "block" | "query" | "tx_status" | "EXPERIMENTAL_tx_status";
const EnvelopeSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.string(), result: z.unknown().optional(), error: z.unknown().optional() });

export function createRpc(config: Config, fetcher: Fetch) {
  let nextId = 0;
  return async (method: Method, params: unknown): Promise<unknown> => {
    const id = `taply-read-${++nextId}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new NearClientError("RPC_TIMEOUT", false)); }, config.timeoutMs);
    });
    const work = async () => {
      const response = await fetcher(config.rpcUrl, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new NearClientError(response.status === 429 ? "RPC_RATE_LIMITED" : "RPC_HTTP_ERROR", false);
      }
      const length = response.headers.get("content-length");
      if (length !== null && /^\d+$/.test(length) && BigInt(length) > BigInt(config.maxResponseBytes)) {
        await response.body?.cancel();
        throw new NearClientError("RPC_RESPONSE_TOO_LARGE");
      }
      if (!response.body) throw new NearClientError("RPC_MALFORMED_RESPONSE");
      const reader = response.body.getReader();
      const cancelReader = () => { void reader.cancel().catch(() => undefined); };
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      let bytes = 0;
      let text = "";
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > config.maxResponseBytes) throw new NearClientError("RPC_RESPONSE_TOO_LARGE");
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } catch (error) {
        void reader.cancel().catch(() => undefined);
        if (error instanceof NearClientError) throw error;
        throw new NearClientError("RPC_MALFORMED_RESPONSE");
      } finally {
        controller.signal.removeEventListener("abort", cancelReader);
        reader.releaseLock();
      }
      let envelope: z.infer<typeof EnvelopeSchema>;
      try { envelope = EnvelopeSchema.parse(parseRpcJson(text)); }
      catch { throw new NearClientError("RPC_MALFORMED_RESPONSE"); }
      if (envelope.id !== id || (Object.hasOwn(envelope, "result") === Object.hasOwn(envelope, "error")))
        throw new NearClientError("RPC_MALFORMED_RESPONSE");
      if (Object.hasOwn(envelope, "error")) {
        const error = z.object({ code: z.unknown(), name: z.string().optional(),
          cause: z.object({ name: z.string() }).optional(),
        }).safeParse(envelope.error);
        if (!error.success) throw new NearClientError("RPC_MALFORMED_RESPONSE");
        const { name, cause, code } = error.data;
        const codes: Record<string, RpcErrorCode> = {
          UNKNOWN_ACCOUNT: "ACCOUNT_NOT_FOUND", UNKNOWN_TRANSACTION: "TRANSACTION_UNKNOWN",
          TIMEOUT_ERROR: "RPC_TIMEOUT", DOES_NOT_TRACK_SHARD: "SHARD_UNAVAILABLE",
          NO_SYNCED_BLOCKS: "NODE_SYNCING",
        };
        if (!isLosslessNumber(code) || !/^-?\d+$/.test(code.toString())) throw new NearClientError("RPC_MALFORMED_RESPONSE");
        const numericCode = code.toString();
        if (numericCode === "-32601") throw new NearClientError("RPC_METHOD_UNAVAILABLE");
        const errorName = cause?.name ?? name ?? "";
        throw new NearClientError(Object.hasOwn(codes, errorName) ? codes[errorName]! : "RPC_ERROR");
      }
      return envelope.result;
    };
    try { return await Promise.race([work(), timeout]); }
    catch (error) {
      if (error instanceof NearClientError) throw error;
      throw new NearClientError("RPC_UNAVAILABLE", false);
    } finally { clearTimeout(timer); }
  };
}
