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
export const INIT_PREPAID_GAS: bigint;
export interface CostPair {
  readonly send_sir: number | string;
  readonly send_not_sir?: number | string;
  readonly execution: number | string;
}
export interface TransactionCosts {
  readonly action_receipt_creation_config: CostPair;
  readonly action_creation_config: {
    readonly deploy_contract_cost: CostPair;
    readonly deploy_contract_cost_per_byte: CostPair;
    readonly function_call_cost: CostPair;
    readonly function_call_cost_per_byte: CostPair;
  };
}
export function isNamedTestnetAccount(accountId: string): boolean;
export function deployGasUpperBound(costs: TransactionCosts, wasmBytes: number, prepaidGas?: bigint): bigint;
export function minimumFunding(input: {
  wasmBytes: number;
  storageUsage: number | string;
  storageByteCostYocto: string;
  gasUnits: bigint;
  gasPriceYocto: string;
}): { storageBytes: bigint; storageYocto: bigint; gasYocto: bigint; totalYocto: bigint };
export function nearToYocto(text: string): bigint;
export function anchored<T>(result: T, blockId: string): T;
export function evaluateAccount(input: {
  accountId?: string | null;
  account: AccountView | null;
  keys: AccessKeyView[];
  storageByteCostYocto: string;
  wasmBytes: number;
  gasUnits?: bigint;
  gasPriceYocto?: string;
  marginYocto?: bigint;
}): Check[];
export function evaluatePostDeploy(input: {
  accountId: string;
  account: { readonly code_hash: string } | null;
  keys: AccessKeyView[];
  config: Record<string, unknown> | null;
  accounting: Record<string, unknown> | null;
  fresh?: boolean;
  expectKey?: string | null;
}): Check[];
export function createRpc(
  url: string,
  fetcher?: (url: string, init: RequestInit) => Promise<Response>,
): (method: string, params: Record<string, unknown> | unknown[]) => Promise<unknown>;
export function main(argv: string[]): Promise<number>;
