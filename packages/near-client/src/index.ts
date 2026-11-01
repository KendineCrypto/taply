import { buildClient } from "./client.js";
import type { NearTestnetClient, NearTestnetConfig } from "./types.js";

export function createNearTestnetClient(config: NearTestnetConfig): NearTestnetClient {
  return buildClient(config, (url, init) => globalThis.fetch(url, init), false, () => new Date());
}
export { NearClientError, TESTNET_GENESIS_HASH } from "./rpc.js";
export { parseRpcJsonWithIntegers } from "./validation.js";
export type * from "./types.js";
export {
  ABI_MINIMUM_GAS, CONTRACT_ERROR_CODES, ContractConfigSchema, CreateQuoteSchema, TerminalFactsSchema,
  contractConfigProblems, extractContractErrorCode, prepareCancelUnfunded, prepareCreateRequest,
  preparePayInstantNative, prepareRetryNativeTransfer,
} from "./contract.js";
export type {
  ContractConfig, ContractConfigProblem, ContractErrorCode, CreateQuote, PaymentRequestRead,
  PreparedContractCall, TerminalFacts, TerminalFactsRead,
} from "./contract.js";
