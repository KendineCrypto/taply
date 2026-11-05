import { buildClient } from "./client.js";
import type { NearTestnetClient, NearTestnetConfig } from "./types.js";

export function createNearTestnetClient(config: NearTestnetConfig): NearTestnetClient {
  return buildClient(config, (url, init) => globalThis.fetch(url, init), false, () => new Date());
}
export { NearClientError, TESTNET_GENESIS_HASH } from "./rpc.js";
export { parseRpcJsonWithIntegers } from "./validation.js";
export { EncryptedTestnetVault, VaultError, VAULT_STORAGE_KEY, VAULT_UNLOCK_MS } from "./wallet-vault.js";
export type { LocalWalletIdentity, VaultStorage } from "./wallet-vault.js";
export { createWalletChain, ed25519PublicKeyFromHex } from "./wallet-chain.js";
export type { WalletChain } from "./wallet-chain.js";
export { WalletAttemptJournal } from "./wallet-journal.js";
export type { WalletAttempt } from "./wallet-journal.js";
export { WalletEngineError, nativeNearToYocto, prepareNativeNearTransfer, spendingBudget, walletAccountId } from "./wallet-transfer.js";
export type { WalletBalanceSnapshot } from "./wallet-transfer.js";
export { createReviewedWalletBackend, WALLET_REVIEW_TTL_MS } from "./wallet-backend.js";
export type { ReviewedWalletBackend, WalletTransactionReview, WalletSubmission, WalletBackendPolicy } from "./wallet-backend.js";
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
export { MERCHANT_CONTRACT_VERSION, createMerchantRequestReader, verifyMerchantObservation, matchMerchantSession } from "./merchant.js";
export type { MerchantDeployment, MerchantSessionExpectation } from "./merchant.js";
export { signMessageCapability, prepareWalletAuthentication } from "./wallet-auth.js";
export { applyRoomCatchUp, RoomCatchUpSchema } from "./room-sync.js";
export type { RoomClientScope, RoomClientState } from "./room-sync.js";
export { MerchantContractConfigSchema, prepareMerchantCreateRequest, prepareMerchantPayInstantNative } from "./merchant.js";
export type { MerchantContractConfig } from "./merchant.js";
