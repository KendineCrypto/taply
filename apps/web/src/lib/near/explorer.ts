/**
 * Pure explorer link helpers (no chain configuration), shared by the Testnet and NEAR
 * Mainnet builds. lib/near/config re-exports them for existing Testnet callers.
 */

/** Explorer evidence link for a transaction. Evidence to look at, not proof by itself. */
export function explorerTransactionUrl(explorerBaseUrl: string, transactionHash: string): string {
  return `${explorerBaseUrl}/txns/${encodeURIComponent(transactionHash)}`;
}
