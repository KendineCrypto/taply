/**
 * Type contract between the two build-selected roots (next.config.ts alias
 * `@taply-root/*`). tsc resolves the alias to the Testnet files; these
 * assignments make the mainnet files fail typecheck if their exports drift.
 * Type-only: nothing here runs or ships.
 */
import type * as TestnetRoot from './testnet/root';
import type * as MainnetRoot from './mainnet/root';
import type TestnetLoading from './testnet/loading';
import type MainnetLoading from './mainnet/loading';
import type TestnetError from './testnet/error';
import type MainnetError from './mainnet/error';
import type TestnetNotFound from './testnet/not-found';
import type MainnetNotFound from './mainnet/not-found';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type RootContract = [
  Same<Parameters<typeof TestnetRoot.Root>, Parameters<typeof MainnetRoot.Root>>,
  Same<Parameters<typeof TestnetLoading>, Parameters<typeof MainnetLoading>>,
  Same<Parameters<typeof TestnetError>, Parameters<typeof MainnetError>>,
  Same<Parameters<typeof TestnetNotFound>, Parameters<typeof MainnetNotFound>>,
];
export const ROOT_CONTRACT_HOLDS: RootContract = [true, true, true, true];
