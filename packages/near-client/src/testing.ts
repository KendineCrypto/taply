import { buildClient } from "./client.js";
import type { Fetch } from "./rpc.js";
import type { NearTestnetClient, NearTestnetConfig } from "./types.js";

/** Explicit test boundary: injected transports can never produce verified chain observations. */
export function createMockNearTestnetClient(config: NearTestnetConfig, dependencies: {
  fetch: Fetch; now: () => Date;
}): NearTestnetClient {
  return buildClient(config, dependencies.fetch, true, dependencies.now);
}
