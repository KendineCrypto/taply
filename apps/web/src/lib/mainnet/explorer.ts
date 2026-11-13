/**
 * Evidence links for the mainnet build. Built only from validated hashes and
 * account IDs; URLs supplied by 1Click are never rendered (they are untrusted
 * input). Links are evidence to look at, not proof.
 */
export const NEARBLOCKS = 'https://nearblocks.io';
export const BASESCAN = 'https://basescan.org';

const NEAR_TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function nearTxUrl(hash: string): string | null {
  return NEAR_TX.test(hash) ? `${NEARBLOCKS}/txns/${hash}` : null;
}
export function nearAccountUrl(accountId: string): string | null {
  return ACCOUNT.test(accountId) ? `${NEARBLOCKS}/address/${accountId}` : null;
}
export function baseTxUrl(hash: string): string | null {
  return EVM_TX.test(hash) ? `${BASESCAN}/tx/${hash.toLowerCase()}` : null;
}
export function baseAddressUrl(address: string): string | null {
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? `${BASESCAN}/address/${address}` : null;
}
