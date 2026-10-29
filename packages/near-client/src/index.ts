import { buildClient, type AccountClient } from "./client.js";
import type { NearTestnetConfig } from "./types.js";

export function createNearTestnetClient(config: NearTestnetConfig): AccountClient {
  return buildClient(config, (url, init) => globalThis.fetch(url, init), false, () => new Date());
}
export { NearClientError, TESTNET_GENESIS_HASH } from "./rpc.js";
export type * from "./types.js";
