import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyPair } from 'near-api-js';
import { createMainnetWalletKeyProof, mainnetAuthorityPayload } from '../dist/index.js';

// Independent existing NEP-413 encoder, shared with the reviewed authority flow.
async function sign(proof, pair, accountId = 'alice.near') {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', mainnetAuthorityPayload(proof.params)));
  return { accountId, publicKey: pair.getPublicKey().toString(), signature: Buffer.from(pair.sign(digest).signature).toString('base64') };
}
test('message-only key proof accepts a real NEP-413 signature once', async () => {
  const pair = KeyPair.fromRandom('ed25519'); const p = createMainnetWalletKeyProof('alice.near', 'https://taply.example');
  assert.equal(await p.accept(await sign(p, pair)), pair.getPublicKey().toString());
  await assert.rejects(p.accept(await sign(p, pair)), /KEY_PROOF_EXPIRED/);
  assert.match(p.params.message, /does not send funds or add access keys/);
});
test('rejects a different account even with a valid signature', async () => {
  const p = createMainnetWalletKeyProof('alice.near', 'https://taply.example');
  await assert.rejects(p.accept(await sign(p, KeyPair.fromRandom('ed25519'), 'bob.near')), /KEY_PROOF_INVALID/);
});
test('rejects substituted public key and mutated signature', async () => {
  for (const mode of ['key', 'signature']) {
    const p = createMainnetWalletKeyProof('alice.near', 'https://taply.example'), s = await sign(p, KeyPair.fromRandom('ed25519'));
    if (mode === 'key') s.publicKey = KeyPair.fromRandom('ed25519').getPublicKey().toString();
    else s.signature = Buffer.alloc(64).toString('base64');
    await assert.rejects(p.accept(s), /KEY_PROOF_INVALID/);
  }
});
test('rejects cross-origin replay of another connection challenge', async () => {
  const pair = KeyPair.fromRandom('ed25519');
  const a = createMainnetWalletKeyProof('alice.near', 'https://a.example'), b = createMainnetWalletKeyProof('alice.near', 'https://b.example');
  await assert.rejects(b.accept(await sign(a, pair)), /KEY_PROOF_INVALID/);
});
test('rejects expired proofs and Testnet accounts without signing anything', async () => {
  let now = 1000; const p = createMainnetWalletKeyProof('alice.near', 'https://taply.example', () => now);
  const s = await sign(p, KeyPair.fromRandom('ed25519')); now += 120000;
  await assert.rejects(p.accept(s), /KEY_PROOF_EXPIRED/);
  assert.throws(() => createMainnetWalletKeyProof('alice.testnet', 'https://taply.example'));
  assert.throws(() => createMainnetWalletKeyProof('alice.near', 'http://taply.example'));
});
