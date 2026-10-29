import { buildClient, type AccountClient } from "./client.js";
import type { Fetch } from "./rpc.js";
import type { NearTestnetConfig } from "./types.js";

/** Explicit test boundary: injected transports can never produce verified chain observations. */
export function createMockNearTestnetClient(config: NearTestnetConfig, dependencies: {
  fetch: Fetch; now: () => Date;
}): AccountClient {
  return buildClient(config, dependencies.fetch, true, dependencies.now);
}
