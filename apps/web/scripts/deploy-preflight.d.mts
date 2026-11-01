// Types for deploy-preflight.mjs, used by its vitest suite only.
export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string | undefined;
}
export interface AccessKeyView {
  readonly public_key: string;
  readonly access_key: { readonly nonce: number; readonly permission: unknown };
}
export interface AccountView {
  readonly amount: string;
  readonly storage_usage: number;
  readonly code_hash: string;
}
export const APPROVED: { readonly sha256: string; readonly codeHash: string; readonly sizeBytes: number };
export const FAULT_BUILD_SHA256: string;
export const TESTNET_GENESIS_HASH: string;
export const EMPTY_CODE_HASH: string;
export const BASE_STATE_ALLOWANCE_BYTES: bigint;
export const MARGIN_YOCTO: bigint;
export const DEFAULT_RPC: string;
export function codeHashFromSha256Hex(hex: string): string;
export function sha256Hex(bytes: Uint8Array): string;
export function evaluateWasm(input: { sha256: string; sizeBytes: number; exportsAbi?: boolean | null }): Check[];
export function evaluateAccount(input: {
  account: AccountView | null;
  keys: AccessKeyView[];
  storageByteCostYocto: string;
  wasmBytes: number;
}): Check[];
export function evaluatePostDeploy(input: {
  accountId: string;
  account: { readonly code_hash: string } | null;
  keys: AccessKeyView[];
  config: Record<string, unknown> | null;
  accounting: Record<string, unknown> | null;
}): Check[];
export function createRpc(
  url: string,
  fetcher?: (url: string, init: RequestInit) => Promise<Response>,
): (method: string, params: Record<string, unknown> | unknown[]) => Promise<unknown>;
export function main(argv: string[]): Promise<number>;
