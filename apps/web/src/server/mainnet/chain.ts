import { createMainnetReader } from '@taply/near-client';
import type { MainnetProfile } from '@taply/near-client';
import { fixtureById } from '@/lib/mainnet/fixtures';
import type { MainnetRequest } from '@/lib/mainnet/fixtures';

/**
 * What the 1Click service needs to know from NEAR, always at a FINAL block with
 * the pinned code hash and mainnet genesis checked by @taply/near-client.
 */
export interface ChainView {
  readonly contractId: string;
  /** Empty when get_config matches the approved mainnet candidate shape for this account. */
  configProblems(): Promise<ReadonlyArray<string>>;
  readRequest(id: string): Promise<{ readonly request: MainnetRequest | null; readonly finalTimestampNs: string }>;
  isUsdcRegistered(accountId: string): Promise<boolean>;
}

export function readerChain(profile: MainnetProfile, fetcher?: typeof fetch): ChainView {
  const reader = createMainnetReader(profile, fetcher);
  return {
    contractId: profile.contract.accountId,
    async configProblems() {
      try {
        await reader.readConfig();
        return [];
      } catch (error) {
        return [error instanceof Error ? error.message.slice(0, 80) : 'CONFIG_UNREADABLE'];
      }
    },
    async readRequest(id) {
      const r = await reader.readRequest(id);
      return { request: r.data, finalTimestampNs: r.timestampNs };
    },
    async isUsdcRegistered(accountId) {
      const r = await reader.readUsdcStorage(accountId);
      return r.data !== null;
    },
  };
}

/** FIXTURE chain: serves lib/mainnet/fixtures.ts. Never used with real funds. */
export function fixtureChain(now: () => number = Date.now): ChainView {
  return {
    contractId: 'devkendinecrypto.near',
    async configProblems() {
      return [];
    },
    async readRequest(id) {
      const entry = fixtureById(id, now());
      return { request: entry?.request ?? null, finalTimestampNs: (BigInt(now()) * 1_000_000n).toString() };
    },
    async isUsdcRegistered() {
      return true;
    },
  };
}
