import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeNearToYocto, walletAccountId, prepareNativeNearTransfer, spendingBudget } from '../dist/wallet-transfer.js';
import { ed25519PublicKeyFromHex } from '../dist/wallet-chain.js';

const snapshot = { network: 'near-testnet', accountId: 'sender.testnet', publicKey: 'public', nonce: '1',
  blockHash: 'hash', blockHeight: '1', blockTimestampNs: '1', amountYocto: '1000000000000000000000000',
  storageUsageBytes: '182', storageByteCostYocto: '10000000000000000000', gasPriceYocto: '100000000' };
test('strict decimal and yocto amounts never use floating point or rounding', () => {
  assert.equal(nativeNearToYocto('0.1'), '100000000000000000000000');
  assert.equal(nativeNearToYocto('0.000000000000000000000001'), '1');
  for (const bad of ['0', '00.1', ' 0.1', '0.1 ', '1e-1', '-1', '+1', '1.', '.1', '0.0000000000000000000000001', '340282366920939', '', 'NaN'])
    assert.throws(() => nativeNearToYocto(bad), { code: 'INVALID_AMOUNT' });
});
test('addresses exclude Mainnet-looking names and malformed or unsupported accounts', () => {
  assert.equal(walletAccountId('receiver.testnet'), 'receiver.testnet');
  assert.equal(walletAccountId('a'.repeat(64)), 'a'.repeat(64));
  for (const bad of ['receiver.near', 'testnet', 'a..testnet', 'A.testnet', ' receiver.testnet', '0x' + 'a'.repeat(40)])
    assert.throws(() => walletAccountId(bad), { code: 'INVALID_ADDRESS' });
});
test('review reserves runtime storage and conservative gas before available-balance check', () => {
  const review = prepareNativeNearTransfer(snapshot, 'receiver.testnet', '0.1');
  assert.equal(review.depositYocto, '100000000000000000000000');
  assert.equal(review.storageReserveYocto, '1820000000000000000000');
  assert.equal(review.gasReserveYocto, '60000000000000000000000');
  assert.equal(review.availableYocto, '938180000000000000000000');
  assert.equal(Object.isFrozen(review), true);
  assert.throws(() => prepareNativeNearTransfer(snapshot, 'receiver.testnet', '0.94'), { code: 'INSUFFICIENT_AVAILABLE_BALANCE' });
  assert.throws(() => prepareNativeNearTransfer({ ...snapshot, network: 'mainnet' }, 'receiver.testnet', '0.1'), { code: 'INVALID_SNAPSHOT' });
});
test('budget rejects numeric coercion and unbounded integers; public-key wire encoding matches known vectors', () => {
  for (const amountYocto of [1e24, '1'.repeat(100000), '-1', '01'])
    assert.throws(() => spendingBudget({ ...snapshot, amountYocto }, '1'), { code: 'INVALID_SNAPSHOT' });
  assert.equal(ed25519PublicKeyFromHex('00'.repeat(32)), 'ed25519:' + '1'.repeat(32));
  assert.equal(ed25519PublicKeyFromHex('a13d932f3b4cadbb4a6580d447a8142f8c704656998659fb3ccebde6ddacb0d2'), 'ed25519:BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B');
});
