import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareWalletAuthentication, signMessageCapability } from '../dist/index.js';
const NOW = 1793500000000, scope = { origin: 'https://taply.example', contractId: 'candidate.testnet', accountId: 'merchant.testnet' };
function challenge(callbackUrl) {
  const fields = { id: 'a'.repeat(43), accountId: scope.accountId, network: 'near-testnet', purpose: 'merchant-login',
    origin: scope.origin, recipient: scope.origin, nonceBase64: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64'),
    state: 'b'.repeat(43), expiresAtMs: NOW + 120000, ...(callbackUrl ? { callbackUrl } : {}) };
  return { ...fields, message: JSON.stringify({ ...fields, contractId: scope.contractId }) };
}
const signed = { accountId: scope.accountId, publicKey: 'ed25519:' + '1'.repeat(32), signature: Buffer.alloc(64).toString('base64') };
test('detect and prepare NEP-413 without invoking a wallet; exact bytes and one-use state correlation', () => {
  let calls = 0;
  assert.equal(signMessageCapability({ signMessage() { calls++; } }), 'available_unverified');
  for (const w of [null, {}, { signTransaction() {} }, { signMessage: true }]) assert.equal(signMessageCapability(w), 'unsupported');
  const c = challenge(), pending = prepareWalletAuthentication(c, scope, () => NOW);
  assert.equal(pending.params.message, c.message); assert.equal(pending.params.recipient, scope.origin);
  assert.deepEqual(pending.params.nonce, Uint8Array.from(Array.from({ length: 32 }, (_, i) => i)));
  assert.equal(pending.delivery, 'direct_only_unverified'); assert.equal(Object.hasOwn(pending.params, 'callbackUrl'), false);
  assert.deepEqual(pending.accept(signed, scope), { ...signed, state: c.state });
  assert.throws(() => pending.accept(signed, scope), /USED/); assert.equal(calls, 0);
});
test('wrong-account, origin, nonce encoding, message, expiry, callback and stale response refuse', () => {
  const c = challenge();
  for (const patch of [{ origin: 'https://evil.example' }, { recipient: 'evil' }, { network: 'mainnet' },
    { nonceBase64: 'AA==' }, { message: c.message + ' ' + '{}' }, { expiresAtMs: NOW }, { callbackUrl: scope.origin + '/wrong' }]) {
    assert.throws(() => prepareWalletAuthentication({ ...c, ...patch }, scope, () => NOW));
  }
  for (const patch of [{ accountId: 'eve.testnet' }, { state: 'wrong' }, { signature: 'AAAA' }, { publicKey: 'secp256k1:123' }, { paid: true }]) {
    assert.throws(() => prepareWalletAuthentication(c, scope, () => NOW).accept({ ...signed, ...patch }, scope));
  }
  assert.throws(() => prepareWalletAuthentication(c, scope, () => NOW).accept(signed, { ...scope, accountId: 'eve.testnet' }));
  let time = NOW; const pending = prepareWalletAuthentication(c, scope, () => time); time += 120000;
  assert.throws(() => pending.accept(signed, scope), /EXPIRED/);
  const cb = challenge(scope.origin + '/auth/callback');
  assert.equal(prepareWalletAuthentication(cb, scope, () => NOW).params.callbackUrl, cb.callbackUrl);
});
