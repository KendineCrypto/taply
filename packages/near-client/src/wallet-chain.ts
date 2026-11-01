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
      const key = anchored(read(z.object({ nonce: RpcU64Schema, permission: z.literal("FullAccess"), block_hash: z.string(), block_height: RpcU64Schema }),
        await rpc("query", { request_type: "view_access_key", account_id: accountId, public_key: publicKey, block_id: block.hash })), block);
      const protocol = read(z.object({ runtime_config: z.object({ storage_amount_per_byte: U128Schema }) }), await rpc("EXPERIMENTAL_protocol_config", { block_id: block.hash }));
      const gas = read(z.object({ gas_price: U128Schema }), await rpc("gas_price", [block.hash]));
      return Object.freeze({ network: "near-testnet", accountId, publicKey, nonce: key.nonce,
        blockHash: block.hash, blockHeight: block.height, blockTimestampNs: block.timestampNs,
        amountYocto: account.amount, storageUsageBytes: account.storage_usage,
        storageByteCostYocto: protocol.runtime_config.storage_amount_per_byte, gasPriceYocto: gas.gas_price });
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
