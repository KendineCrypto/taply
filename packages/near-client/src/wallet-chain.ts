import { z } from "zod";
import { U128Schema } from "@taply/shared";
import { createRpc, parseConfig, TESTNET_GENESIS_HASH, NearClientError } from "./rpc.js";
import { AccountSchema, BlockSchema, RpcU64Schema } from "./validation.js";
import type { Fetch } from "./rpc.js";
import type { NearTestnetConfig } from "./types.js";
import { WalletEngineError, walletAccountId } from "./wallet-transfer.js";
import type { WalletBalanceSnapshot } from "./wallet-transfer.js";

/** Public-key wire encoding only (same base58 alphabet as the RPC hash reader).
 * This performs no key derivation, encryption, hashing or signing.
 */
export function ed25519PublicKeyFromHex(hex: string): string {
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new WalletEngineError("KEY_NOT_AUTHORIZED");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${hex}`); let encoded = "";
  while (n > 0n) { encoded = alphabet[Number(n % 58n)] + encoded; n /= 58n; }
  for (const byte of hex.match(/../g) ?? []) { if (byte !== "00") break; encoded = `1${encoded}`; }
  return `ed25519:${encoded}`;
}

export function createWalletChain(config: NearTestnetConfig, fetcher: Fetch = (url, init) => globalThis.fetch(url, init)) {
  const rpc = createRpc(parseConfig(config), fetcher);
  const read = <T>(schema: z.ZodType<T>, raw: unknown): T => {
    const result = schema.safeParse(raw);
    if (!result.success) throw new WalletEngineError("INVALID_SNAPSHOT");
    return result.data;
  };
  const checkNetwork = async () => {
    const status = read(z.object({ chain_id: z.string(), genesis_hash: z.string(), sync_info: z.object({ syncing: z.boolean() }) }), await rpc("status", []));
    if (status.chain_id !== "testnet" || status.genesis_hash !== TESTNET_GENESIS_HASH || status.sync_info.syncing)
      throw new WalletEngineError("NETWORK_MISMATCH");
  };
  const anchored = <T extends { block_hash: string; block_height: string }>(value: T, block: { hash: string; height: string }) => {
    if (value.block_hash !== block.hash || value.block_height !== block.height) throw new WalletEngineError("INVALID_SNAPSHOT");
    return value;
  };
  return {
    checkNetwork,
    async snapshot(accountId: string, publicKey: string): Promise<WalletBalanceSnapshot | null> {
      walletAccountId(accountId);
      if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKey)) throw new WalletEngineError("KEY_NOT_AUTHORIZED");
      await checkNetwork();
      const block = read(BlockSchema, await rpc("block", { finality: "final" }));
      let rawAccount: unknown;
      try { rawAccount = await rpc("query", { request_type: "view_account", account_id: accountId, block_id: block.hash }); }
      catch (e) { if (e instanceof NearClientError && e.code === "ACCOUNT_NOT_FOUND") return null; throw e; }
      const account = anchored(read(AccountSchema, rawAccount), block);
      // Independent reads share the already selected FINAL block. Keep the
      // account-existence check first so unprovisioned identities remain LOCAL_ONLY.
      const [rawKey, rawProtocol, rawGas] = await Promise.all([
        rpc("query", { request_type: "view_access_key", account_id: accountId, public_key: publicKey, block_id: block.hash }),
        rpc("EXPERIMENTAL_protocol_config", { block_id: block.hash }),
        rpc("gas_price", [block.hash]),
      ]);
      const key = anchored(read(z.object({ nonce: RpcU64Schema, permission: z.literal("FullAccess"), block_hash: z.string(), block_height: RpcU64Schema }), rawKey), block);
      const protocol = read(z.object({ runtime_config: z.object({ storage_amount_per_byte: U128Schema }) }), rawProtocol);
      const gas = read(z.object({ gas_price: U128Schema }), rawGas);
      return Object.freeze({ network: "near-testnet", accountId, publicKey, nonce: key.nonce,
        blockHash: block.hash, blockHeight: block.height, blockTimestampNs: block.timestampNs,
        amountYocto: account.amount, storageUsageBytes: account.storage_usage,
        storageByteCostYocto: protocol.runtime_config.storage_amount_per_byte, gasPriceYocto: gas.gas_price });
    },
    /** Whether an account exists at the current FINAL block (name availability). */
    async accountExists(accountId: string): Promise<boolean> {
      walletAccountId(accountId);
      await checkNetwork();
      const block = read(BlockSchema, await rpc("block", { finality: "final" }));
      let rawAccount: unknown;
      try { rawAccount = await rpc("query", { request_type: "view_account", account_id: accountId, block_id: block.hash }); }
      catch (e) { if (e instanceof NearClientError && e.code === "ACCOUNT_NOT_FOUND") return false; throw e; }
      anchored(read(AccountSchema, rawAccount), block);
      return true;
    },
    /**
     * Provisioning proof for a vault identity, read at ONE final block:
     * - ACCOUNT_NOT_FOUND: no account with this ID (a name is still free);
     * - KEY_NOT_ON_ACCOUNT: the account exists but does not hold this key with full
     *   access (e.g. someone else owns the name);
     * - ON_CHAIN: the account exists and lists this exact key as FullAccess.
     * Never inferred from a faucet or transfer response.
     */
    async provisioning(accountId: string, publicKey: string): Promise<"ACCOUNT_NOT_FOUND" | "KEY_NOT_ON_ACCOUNT" | "ON_CHAIN"> {
      walletAccountId(accountId);
      if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKey)) throw new WalletEngineError("KEY_NOT_AUTHORIZED");
      await checkNetwork();
      const block = read(BlockSchema, await rpc("block", { finality: "final" }));
      let rawAccount: unknown;
      try { rawAccount = await rpc("query", { request_type: "view_account", account_id: accountId, block_id: block.hash }); }
      catch (e) { if (e instanceof NearClientError && e.code === "ACCOUNT_NOT_FOUND") return "ACCOUNT_NOT_FOUND"; throw e; }
      anchored(read(AccountSchema, rawAccount), block);
      const list = anchored(read(z.object({ block_hash: z.string(), block_height: RpcU64Schema,
        keys: z.array(z.object({ public_key: z.string(), access_key: z.object({ permission: z.unknown() }) })).max(10_000) }),
      await rpc("query", { request_type: "view_access_key_list", account_id: accountId, block_id: block.hash })), block);
      return list.keys.some((k) => k.public_key === publicKey && k.access_key.permission === "FullAccess") ? "ON_CHAIN" : "KEY_NOT_ON_ACCOUNT";
    },
    async receiverExists(receiverId: string, blockHash: string): Promise<void> {
      walletAccountId(receiverId);
      await checkNetwork();
      // Unknown receivers are refused: this wallet never creates an account by transferring.
      const account = read(AccountSchema, await rpc("query", { request_type: "view_account", account_id: receiverId, block_id: blockHash }));
      if (account.block_hash !== blockHash) throw new WalletEngineError("INVALID_SNAPSHOT");
    },
  };
}
export type WalletChain = ReturnType<typeof createWalletChain>;
