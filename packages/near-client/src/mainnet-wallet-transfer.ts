import { z } from 'zod';
import { MainnetAccountSchema, MAINNET_USDC, U128Schema, U64Schema } from '@taply/shared';
import { HashSchema } from './validation.js';
import { nativeNearToYocto } from './wallet-transfer.js';

export const MainnetWalletSnapshotSchema = z.strictObject({ network: z.literal('near-mainnet'),
  accountId: MainnetAccountSchema, publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  nonce: U64Schema, blockHash: HashSchema, blockHeight: U64Schema, blockTimestampNs: U64Schema,
  amountYocto: U128Schema, storageUsageBytes: U64Schema, storageByteCostYocto: U128Schema, gasPriceYocto: U128Schema });
export type MainnetWalletSnapshot = z.infer<typeof MainnetWalletSnapshotSchema>;
export function mainnetSpendingBudget(snapshot: MainnetWalletSnapshot, depositYocto: string) {
  const s = MainnetWalletSnapshotSchema.parse(snapshot); U128Schema.parse(depositYocto);
  if (BigInt(s.storageByteCostYocto) === 0n || BigInt(s.gasPriceYocto) === 0n) throw new Error('INVALID_SNAPSHOT');
  const storageReserve = BigInt(s.storageUsageBytes) * BigInt(s.storageByteCostYocto);
  const gasReserve = 300_000_000_000_000n * BigInt(s.gasPriceYocto) * 2n;
  const remainder = BigInt(s.amountYocto) - storageReserve - gasReserve;
  const available = remainder > 0n ? remainder : 0n;
  if (BigInt(depositYocto) > available) throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
  return { storageReserveYocto: storageReserve.toString(), gasReserveYocto: gasReserve.toString(), availableYocto: available.toString() };
}
export function prepareMainnetNativeTransfer(snapshot: MainnetWalletSnapshot, receiverId: string, amountNear: string) {
  MainnetAccountSchema.parse(receiverId);
  if (snapshot.accountId === receiverId) throw new Error('SELF_TRANSFER');
  const depositYocto = nativeNearToYocto(amountNear);
  return Object.freeze({ network: 'near-mainnet' as const, kind: 'native_transfer' as const,
    signerAccountId: snapshot.accountId, receiverId, depositYocto, ...mainnetSpendingBudget(snapshot, depositYocto) });
}
/** Exact base units. Registration/balance evidence must share the spending block.
 * This is an unsigned candidate, not permission to sign a caller-supplied snapshot. */
export function prepareMainnetUsdcTransfer(input: { snapshot: MainnetWalletSnapshot; receiverId: string;
  amountBaseUnits: string; tokenEvidence: { blockHash: string; accountId: string; receiverId: string;
    balance: string; senderRegistered: boolean; receiverRegistered: boolean } }) {
  const { snapshot: s, tokenEvidence: e } = input;
  MainnetAccountSchema.parse(input.receiverId); U128Schema.parse(input.amountBaseUnits); U128Schema.parse(e.balance);
  if (input.receiverId === s.accountId || BigInt(input.amountBaseUnits) === 0n || BigInt(input.amountBaseUnits) > BigInt(e.balance))
    throw new Error('INVALID_TOKEN_AMOUNT_OR_RECIPIENT');
  if (e.blockHash !== s.blockHash || e.accountId !== s.accountId || e.receiverId !== input.receiverId || !e.senderRegistered || !e.receiverRegistered)
    throw new Error('INVALID_TOKEN_EVIDENCE');
  return Object.freeze({ network: 'near-mainnet' as const, signerAccountId: s.accountId, receiverId: MAINNET_USDC,
    methodName: 'ft_transfer' as const, args: { receiver_id: input.receiverId, amount: input.amountBaseUnits },
    gas: '30000000000000', depositYocto: '1', ...mainnetSpendingBudget(s, '1') });
}
