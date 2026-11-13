// Types for check-mainnet-env.mjs, used by its vitest suite only.
export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string | undefined;
}
export type Env = Readonly<Record<string, string | undefined>>;
export const MAINNET: {
  readonly network: 'near-mainnet';
  readonly hostname: string;
  readonly shareOrigin: string;
  readonly productionContract: string;
  readonly stagingContract: string;
  readonly recoveryAccount: string;
  readonly explorer: string;
  readonly rpcHosts: ReadonlyArray<string>;
};
export const TESTNET_ORIGINS: ReadonlyArray<string>;
export const TESTNET_CODE_HASHES: ReadonlyArray<string>;
export const ENV_FILES: ReadonlyArray<string>;
export function parseEnvFile(text: string): { values: Record<string, string>; problems: string[] };
export function resolveBuildEnv(
  processEnv: Env,
  files: Readonly<Record<string, string | undefined>>,
): { env: Record<string, string>; source: Record<string, string>; problems: string[] };
export function evaluateMainnetEnv(input: {
  env: Env;
  source?: Readonly<Record<string, string>>;
  vercelEnv?: string | undefined;
  requireMainnet?: boolean;
}): { mainnet: boolean; checks: Check[] };
export function describeValue(key: string, value: string | undefined): string;
export function readEnvFiles(dir: string): Record<string, string>;
export function main(
  argv?: string[],
  processEnv?: Env,
  dir?: string,
  log?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
): number;
