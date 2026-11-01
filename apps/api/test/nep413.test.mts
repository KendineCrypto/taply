import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { Challenges } from '../src/auth.mts';
import { createNep413Verifier, nep413Payload } from '../src/nep413.mts';
import { ed25519PublicKeyFromHex } from '../../../packages/near-client/dist/wallet-chain.js';

// Disposable off-chain test key; never a wallet key and never persisted.
export function testSigner() {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = ed25519PublicKeyFromHex(keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex'));
  return (c: import('../src/auth.mts').Challenge) => ({ accountId: c.accountId, state: c.state, publicKey,
    signature: sign(null, createHash('sha256').update(nep413Payload(c.message, c.nonceBase64, c.recipient, c.callbackUrl)).digest(), keys.privateKey).toString('base64') });
}
test('NEP-413 published example encodes exact independent Borsh bytes', () => {
  const expected = '9d010080020000006869' + Buffer.from(Array.from({length:32}, (_,i)=>i)).toString('hex')
    + '090000006d796170702e636f6d01120000006d796170702e636f6d2f63616c6c6261636b';
  assert.equal(nep413Payload('hi', Buffer.from(Array.from({length:32},(_,i)=>i)).toString('base64'), 'myapp.com', 'myapp.com/callback').toString('hex'), expected);
});
test('real Ed25519 signature plus independently associated key required; callback bytes bound', async () => {
  const store = new Challenges('https://taply.example', 'pilot.testnet'); const c = store.issue('merchant.testnet');
  const signer = testSigner(); const signed = signer(c); let calls = 0;
  const verifier = createNep413Verifier(c.origin, 'pilot.testnet', async (accountId, publicKey) => {
    calls++; return { accountId, publicKey, blockHash: '1'.repeat(32), blockHeight: '1' };
  });
  assert.equal((await store.consume(c.id, c.accountId, c.origin, c.state, signed, verifier)).accountId, c.accountId);
  await assert.rejects(store.consume(c.id, c.accountId, c.origin, c.state, signed, verifier), /USED/); assert.equal(calls, 1);
  const { message: _message, ...fields } = store.issue('merchant.testnet');
  void _message;
  const callback = { ...fields, callbackUrl: `${c.origin}/auth/callback` };
  const cb = { ...callback, message: JSON.stringify({ ...callback, contractId: 'pilot.testnet' }) };
  await verifier.verify(cb, signer(cb));
  await assert.rejects(verifier.verify({ ...cb, callbackUrl: `${c.origin}/wrong` }, signer(cb)));
});
test('forgery, wrong account/state/origin/recipient, nonce, payload sizes and association fail closed', async () => {
  const c = new Challenges('https://taply.example', 'pilot.testnet').issue('merchant.testnet'); const signed = testSigner()(c);
  const association = async (accountId: string, publicKey: string) => ({ accountId, publicKey, blockHash:'1'.repeat(32), blockHeight:'1' });
  const v = createNep413Verifier(c.origin, 'pilot.testnet', association);
  for (const mutation of [{signature:'A'.repeat(88)}, {accountId:'evil.testnet'}, {state:'evil'}, {publicKey:'ed25519:'+'1'.repeat(32)}, {paid:true}])
    await assert.rejects(v.verify(c, {...signed,...mutation}));
  for (const mutation of [{origin:'https://evil.example'}, {recipient:'evil'}, {nonceBase64:'AA=='}, {message:'x'.repeat(5000)}])
    await assert.rejects(v.verify({...c,...mutation}, signed));
  await assert.rejects(createNep413Verifier(c.origin,'pilot.testnet',async()=>{throw Error('RPC_UNAVAILABLE');}).verify(c,signed), /RPC_UNAVAILABLE/);
  await assert.rejects(createNep413Verifier(c.origin,'pilot.testnet',async()=>({...await association(c.accountId,signed.publicKey),accountId:'evil.testnet'})).verify(c,signed));
  await assert.rejects(createNep413Verifier(c.origin,'pilot.testnet',association,()=>c.expiresAtMs).verify(c,signed), /EXPIRED/);
});
