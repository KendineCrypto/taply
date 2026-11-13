import type { NearConnectorOptions } from '@hot-labs/near-connect';

/**
 * NEAR Connect options for the mainnet build, from @hot-labs/near-connect
 * 0.12.0's own types (NearConnectorOptions, WalletFeatures):
 *  - network 'mainnet' and only the profile's mainnet RPC as provider;
 *  - features.mainnet: list only wallets whose manifest declares mainnet;
 *  - signInWithoutAddKey: connecting never adds a key to the user's account;
 *  - signAndSendTransaction: only wallets that could sign later are offered,
 *    but this build exposes NO signing call while the release gate is closed;
 *  - autoConnect false: never connect without an explicit tap.
 * Testnet settings are not present at all (no testnet provider, no testnet feature).
 */
export function mainnetConnectorOptions(rpcUrl: string, cspNonce: string | undefined): NearConnectorOptions {
  return {
    network: 'mainnet',
    providers: { mainnet: [rpcUrl] },
    features: { mainnet: true, signInWithoutAddKey: true, signAndSendTransaction: true },
    autoConnect: false,
    footerBranding: null,
    ...(cspNonce === undefined ? {} : { cspNonce }),
  };
}

/**
 * The page's CSP nonce, for wallet iframes (same rule as the Testnet adapter's
 * `pageCspNonce`, copied so the mainnet bundle does not import the Testnet
 * near-connect adapter module).
 */
export function pageCspNonce(doc: Document = document): string | undefined {
  for (const script of doc.querySelectorAll<HTMLScriptElement>('script[nonce]')) {
    const value = script.nonce || script.getAttribute('nonce') || '';
    if (/^[A-Za-z0-9+/=]{16,128}$/.test(value)) return value;
  }
  return undefined;
}
