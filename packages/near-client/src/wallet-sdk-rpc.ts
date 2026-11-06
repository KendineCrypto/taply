import { JsonRpcProvider } from "near-api-js";
import { parseRpcJsonWithIntegers } from "./validation.js";
import { parseConfig } from "./rpc.js";
import type { NearTestnetConfig } from "./types.js";
import type { Fetch } from "./rpc.js";
import { WalletEngineError } from "./wallet-transfer.js";

/** SDK transaction wire format, with a single bounded HTTP attempt. No SDK
 * backoff/failover or Account nonce-resubmission path can run here. Redirects
 * and credentials are refused. All broadcast callers must supply a live guard.
 */
export class OneShotWalletProvider extends JsonRpcProvider {
  #nextId = 0;
  private readonly config;
  constructor(config: NearTestnetConfig, private readonly fetcher: Fetch,
    private readonly beforeBroadcast: () => void) {
    const checked = parseConfig(config);
    super({ url: checked.rpcUrl }, { retries: 1, wait: 0, backoff: 1 });
    this.config = checked;
  }
  override async sendJsonRpc<T>(method: string, params: unknown): Promise<T> {
    const p = params as Record<string, unknown>;
    if (method !== "send_tx" && method !== "EXPERIMENTAL_tx_status") throw new WalletEngineError("CALL_NOT_ALLOWED");
    if (p["wait_until"] !== "FINAL") throw new WalletEngineError("CALL_NOT_ALLOWED");
    if (method === "send_tx") this.beforeBroadcast();
    const id = `taply-wallet-${++this.#nextId}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new WalletEngineError("RPC_UNAVAILABLE")); }, this.config.timeoutMs);
    });
    const work = async () => {
      const response = await this.fetcher(this.config.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: controller.signal,
        credentials: "omit", redirect: "error", cache: "no-store" });
      if (!response.ok) { await response.body?.cancel(); throw new WalletEngineError("RPC_UNAVAILABLE"); }
      if (!response.body) throw new WalletEngineError("RPC_UNAVAILABLE");
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      controller.signal.addEventListener("abort", cancel, { once: true });
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let text = ""; let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 4 * 1024 * 1024) throw new WalletEngineError("RPC_UNAVAILABLE");
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { controller.signal.removeEventListener("abort", cancel); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const body = parseRpcJsonWithIntegers(text) as Record<string, unknown>;
      if (!body || body["jsonrpc"] !== "2.0" || body["id"] !== id ||
        Object.hasOwn(body, "error") === Object.hasOwn(body, "result") || Object.hasOwn(body, "error"))
        throw new WalletEngineError("RPC_UNAVAILABLE");
      return body["result"] as T;
    };
    try { return await Promise.race([work(), timeout]); }
    catch { throw new WalletEngineError("RPC_UNAVAILABLE"); }
    finally { clearTimeout(timer); }
  }
}
