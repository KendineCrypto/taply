import { AccountIdSchema, U128_MAX } from "@taply/shared";

export const WALLET_NETWORK = "near-testnet" as const;
export const WALLET_GAS_RESERVE_UNITS = 300_000_000_000_000n;
export const WALLET_MAX_CALL_GAS = 100_000_000_000_000n;
export class WalletEngineError extends Error {
  constructor(readonly code: "INVALID_AMOUNT" | "INVALID_ADDRESS" | "INSUFFICIENT_AVAILABLE_BALANCE" |
    "INVALID_SNAPSHOT" | "SIGNING_DISABLED" | "ACCOUNT_NOT_PROVISIONED" | "KEY_NOT_AUTHORIZED" |
    "REVIEW_EXPIRED" | "REVIEW_REJECTED" | "OUTCOME_UNRESOLVED" | "STORAGE_UNAVAILABLE" |
    "NETWORK_MISMATCH" | "RPC_UNAVAILABLE" | "CALL_NOT_ALLOWED" | "LOCKED" | "SIGNATURE_INVALID") {
    super(`taply-wallet:${code}`); this.name = "WalletEngineError";
  }
}

/** Intentionally accepts Testnet names and native Ed25519 implicit IDs only. */
export function walletAccountId(value: string): string {
  if (!AccountIdSchema.safeParse(value).success ||
    !(value.endsWith(".testnet") || /^[a-f0-9]{64}$/.test(value))) throw new WalletEngineError("INVALID_ADDRESS");
  return value;
}
export function nativeNearToYocto(value: string): string {
  if (typeof value !== "string" || value.length > 64 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,24})?$/.test(value))
    throw new WalletEngineError("INVALID_AMOUNT");
  const [whole = "0", fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
  if (amount <= 0n || amount > U128_MAX) throw new WalletEngineError("INVALID_AMOUNT");
  return amount.toString();
}
export interface WalletBalanceSnapshot {
  readonly network: "near-testnet";
  readonly accountId: string;
  readonly publicKey: string;
  readonly nonce: string;
  readonly blockHash: string;
  readonly blockHeight: string;
  readonly blockTimestampNs: string;
  readonly amountYocto: string;
  readonly storageUsageBytes: string;
  readonly storageByteCostYocto: string;
  readonly gasPriceYocto: string;
}
export function spendingBudget(snapshot: WalletBalanceSnapshot, depositYocto: string) {
  const uint = /^(0|[1-9][0-9]*)$/;
  if (snapshot.network !== WALLET_NETWORK ||
    ![snapshot.amountYocto, snapshot.storageUsageBytes, snapshot.storageByteCostYocto, snapshot.gasPriceYocto, depositYocto]
      .every((x) => typeof x === "string" && x.length <= 39 && uint.test(x)))
    throw new WalletEngineError("INVALID_SNAPSHOT");
  const amount = BigInt(snapshot.amountYocto);
  const storageReserve = BigInt(snapshot.storageUsageBytes) * BigInt(snapshot.storageByteCostYocto);
  // Conservative: keep ALL storage collateral from liquid balance, even when staked.
  // Reserve 300 Tgas at twice the observed price; this is not a quoted network fee.
  const gasReserve = WALLET_GAS_RESERVE_UNITS * BigInt(snapshot.gasPriceYocto) * 2n;
  if (BigInt(snapshot.storageByteCostYocto) <= 0n || BigInt(snapshot.gasPriceYocto) <= 0n ||
    amount > U128_MAX || BigInt(depositYocto) > U128_MAX) throw new WalletEngineError("INVALID_SNAPSHOT");
  const available = amount > storageReserve + gasReserve ? amount - storageReserve - gasReserve : 0n;
  if (BigInt(depositYocto) > available) throw new WalletEngineError("INSUFFICIENT_AVAILABLE_BALANCE");
  return Object.freeze({ storageReserveYocto: storageReserve.toString(), gasReserveYocto: gasReserve.toString(), availableYocto: available.toString() });
}
export function prepareNativeNearTransfer(snapshot: WalletBalanceSnapshot, receiverId: string, amountNear: string) {
  walletAccountId(snapshot.accountId); walletAccountId(receiverId);
  if (receiverId === snapshot.accountId) throw new WalletEngineError("INVALID_ADDRESS");
  const depositYocto = nativeNearToYocto(amountNear);
  return Object.freeze({ network: WALLET_NETWORK, kind: "native_transfer" as const,
    signerAccountId: snapshot.accountId, receiverId, depositYocto, ...spendingBudget(snapshot, depositYocto) });
}
