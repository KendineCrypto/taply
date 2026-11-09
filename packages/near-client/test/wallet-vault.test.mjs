import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EncryptedTestnetVault, VAULT_STORAGE_KEY, VAULT_UNLOCK_MS } from '../dist/wallet-vault.js';

const password = 'synthetic-test-only-passphrase';
function memory() { const data = new Map(); return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; }

test('Web Crypto Ed25519 identity is local only; storage has ciphertext, reload is locked', async () => {
  const storage = memory(); const vault = new EncryptedTestnetVault(storage);
  const id = await vault.create(password);
  assert.equal(id.provisioning, 'LOCAL_ONLY');
  assert.equal(id.accountId, id.publicKeyHex);
  assert.match(id.publicKeyHex, /^[a-f0-9]{64}$/);
  const raw = storage.getItem(VAULT_STORAGE_KEY);
  assert.equal(raw.includes(password), false);
  assert.equal(raw.includes('PRIVATE KEY'), false);
  assert.equal(Object.hasOwn(JSON.parse(raw), 'privateKey'), false);
  assert.equal(vault.unlocked, false);
  await vault.unlock(password); assert.equal(vault.unlocked, true);
  assert.equal(new EncryptedTestnetVault(storage).unlocked, false);
  assert.equal('signTestnetDigest' in vault, false);
  vault.lock(); assert.equal(vault.unlocked, false);
});

test('explicit lock, record replacement and expiry revoke unlocked key state', async () => {
  let now = 0; const storage = memory(); const vault = new EncryptedTestnetVault(storage, { now: () => now });
  await vault.create(password); await vault.unlock(password);
  assert.equal(vault.unlocked, true);
  now = VAULT_UNLOCK_MS;
  assert.equal(vault.unlocked, false);
  await vault.unlock(password); storage.setItem(VAULT_STORAGE_KEY, '{}');
  assert.equal(vault.unlocked, false);
});

test('encrypted backup restores same identity into empty storage, locked; wrong password fails', async () => {
  const source = new EncryptedTestnetVault(memory()); const id = await source.create(password);
  const backup = source.exportEncryptedBackup(); const restored = new EncryptedTestnetVault(memory());
  await assert.rejects(restored.restoreEncryptedBackup(backup, 'wrong-but-long-password'), { code: 'BAD_PASSWORD_OR_DATA' });
  assert.equal(restored.getIdentity(), null);
  assert.deepEqual(await restored.restoreEncryptedBackup(backup, password), id);
  assert.equal(restored.unlocked, false);
  await restored.unlock(password); restored.lock();
  await assert.rejects(restored.restoreEncryptedBackup(backup, password), { code: 'ALREADY_EXISTS' });
});

test('ciphertext and authenticated identity tampering fail; KDF/network downgrade is refused', async () => {
  const source = new EncryptedTestnetVault(memory()); await source.create(password);
  const saved = JSON.parse(source.exportEncryptedBackup());
  for (const mutate of [
    r => { r.ciphertext = (r.ciphertext[0] === '0' ? '1' : '0') + r.ciphertext.slice(1); },
    r => { r.publicKeyHex = r.accountId = '0'.repeat(64); },
    r => { r.network = 'mainnet'; }, r => { r.iterations = 1; }, r => { r.iterations = 1000000000; },
  ]) {
    const record = structuredClone(saved); mutate(record);
    const vault = new EncryptedTestnetVault(memory());
    await assert.rejects(vault.restoreEncryptedBackup(JSON.stringify(record), password));
    assert.equal(vault.getIdentity(), null); assert.equal(vault.unlocked, false);
  }
});

test('lock during asynchronous unlock cannot resurrect a key', async () => {
  const vault = new EncryptedTestnetVault(memory()); await vault.create(password);
  const pending = vault.unlock(password); vault.lock();
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(vault.unlocked, false);
});
test('lock during generation leaves no vault; duplicate backup fields are rejected', async () => {
  const vault = new EncryptedTestnetVault(memory());
  const pending = vault.create(password); vault.lock();
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(vault.getIdentity(), null);
  await assert.rejects(vault.restoreEncryptedBackup('{"version":1,"version":1}', password), { code: 'INVALID_RECORD' });
});

test('vault refuses weak passwords, plaintext recovery, corrupted and unavailable persistence', async () => {
  const vault = new EncryptedTestnetVault(memory());
  await assert.rejects(vault.create('123456'), { code: 'PASSWORD_POLICY' });
  await assert.rejects(vault.restoreEncryptedBackup('ed25519:not-a-backup', password), { code: 'INVALID_RECORD' });
  const unavailable = new EncryptedTestnetVault({ getItem: () => null, setItem: () => { throw Error('never surface raw secrets'); } });
  await assert.rejects(unavailable.create(password), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(unavailable.unlocked, false);
});

test('named *.testnet identity: bound in authenticated metadata, local only, restorable', async () => {
  const storage = memory(); const vault = new EncryptedTestnetVault(storage);
  const id = await vault.create(password, 'alice-01.testnet');
  assert.equal(id.accountId, 'alice-01.testnet');
  assert.equal(id.provisioning, 'LOCAL_ONLY');
  assert.match(id.publicKeyHex, /^[a-f0-9]{64}$/);
  assert.equal(vault.unlocked, false);
  assert.deepEqual(await vault.unlock(password), id); vault.lock();
  const backup = vault.exportEncryptedBackup();
  const restored = new EncryptedTestnetVault(memory());
  assert.deepEqual(await restored.restoreEncryptedBackup(backup, password), id);
  // The account ID is authenticated: renaming the record breaks decryption.
  const renamed = JSON.parse(backup); renamed.accountId = 'mallory.testnet';
  await assert.rejects(new EncryptedTestnetVault(memory()).restoreEncryptedBackup(JSON.stringify(renamed), password), { code: 'BAD_PASSWORD_OR_DATA' });
});

test('named identity refuses non-testnet, malformed and implicit-looking IDs; implicit must equal key', async () => {
  for (const bad of ['testnet', '.testnet', 'alice.near', 'Alice.testnet', 'a..b.testnet', '-a.testnet', 'a'.repeat(57) + '.testnet', '0'.repeat(64)]) {
    const vault = new EncryptedTestnetVault(memory());
    await assert.rejects(vault.create(password, bad), { code: 'INVALID_ACCOUNT_ID' }, bad);
    assert.equal(vault.getIdentity(), null);
  }
  const source = new EncryptedTestnetVault(memory()); await source.create(password);
  const record = JSON.parse(source.exportEncryptedBackup()); record.accountId = 'f'.repeat(64);
  await assert.rejects(new EncryptedTestnetVault(memory()).restoreEncryptedBackup(JSON.stringify(record), password), { code: 'INVALID_RECORD' });
});

test('rebindAccount keeps the key, needs the passphrase, refreshes salt/IV and stays locked', async () => {
  const storage = memory(); const vault = new EncryptedTestnetVault(storage);
  const first = await vault.create(password, 'taken-name.testnet');
  const before = JSON.parse(storage.getItem(VAULT_STORAGE_KEY));
  await assert.rejects(vault.rebindAccount('wrong-but-long-password', 'free-name.testnet'), { code: 'BAD_PASSWORD_OR_DATA' });
  await assert.rejects(vault.rebindAccount(password, 'free.near'), { code: 'INVALID_ACCOUNT_ID' });
  assert.deepEqual(vault.getIdentity(), first);
  await vault.unlock(password);
  const next = await vault.rebindAccount(password, 'free-name.testnet');
  assert.equal(vault.unlocked, false);
  assert.equal(next.accountId, 'free-name.testnet');
  assert.equal(next.publicKeyHex, first.publicKeyHex);
  const after = JSON.parse(storage.getItem(VAULT_STORAGE_KEY));
  assert.notEqual(after.salt, before.salt); assert.notEqual(after.iv, before.iv);
  assert.deepEqual(await vault.unlock(password), next);
  // An implicit vault can also be bound to a name (same key).
  const implicit = new EncryptedTestnetVault(memory()); const local = await implicit.create(password);
  assert.equal((await implicit.rebindAccount(password, 'named.testnet')).publicKeyHex, local.publicKeyHex);
});

test('rebind is cancelled by a concurrent lock and leaves the original record', async () => {
  const storage = memory(); const vault = new EncryptedTestnetVault(storage);
  await vault.create(password, 'one.testnet'); const raw = storage.getItem(VAULT_STORAGE_KEY);
  const pending = vault.rebindAccount(password, 'two.testnet'); vault.lock();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(storage.getItem(VAULT_STORAGE_KEY), raw);
});

// ---- 12-word recovery phrase (Phantom-style), NEAR derivation m/44'/397'/0' ----
import { createHash, webcrypto } from 'node:crypto';
import { PublicKey } from 'near-api-js';
import { BIP39_ENGLISH } from '../dist/bip39-english.js';

const keyHex = (pk) => Buffer.from(PublicKey.from(pk).data).toString('hex');
// Expected keys computed with near-seed-phrase 0.2.1 (the library MyNearWallet/Meteor use).
const VECTORS = [
  ['abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'ed25519:6j4b6zUaty6fD1awqcGCCU9JYGCWYUgdJhQrzfZhqE25'],
  ['legal winner thank year wave sausage worth useful legal winner thank yellow', 'ed25519:5shPrRr1NRJL7aTdCMqSSKxfUHvacCTEjCkCEpd26RmJ'],
  ['zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', 'ed25519:Cxua8Jtcu4414fr97m1CHqVt7WWFdkca1pFkdtLefD5n'],
];

test('BIP-39 English wordlist is the standard list', () => {
  assert.equal(BIP39_ENGLISH.length, 2048);
  assert.equal(createHash('sha256').update(BIP39_ENGLISH.join('\n') + '\n').digest('hex'), '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
});

test('imported phrases derive the same key as MyNearWallet/Meteor (near-seed-phrase vectors)', async () => {
  for (const [phrase, publicKey] of VECTORS) {
    const vault = new EncryptedTestnetVault(memory());
    const id = await vault.restoreFromRecoveryPhrase(`  ${phrase.toUpperCase()} `, password, 'vector.testnet');
    assert.equal(id.publicKeyHex, keyHex(publicKey), phrase);
    assert.equal(id.recovery, 'RECOVERY_PHRASE');
    assert.equal(vault.unlocked, false);
    assert.deepEqual(await vault.unlock(password), id);
    assert.equal((await vault.revealRecoveryPhrase(password)).join(' '), phrase);
  }
});

test('new wallets have a 12-word phrase: revealed only with the password, never stored in clear, restorable elsewhere', async () => {
  const storage = memory(); const vault = new EncryptedTestnetVault(storage);
  const id = await vault.create(password, 'phrase-owner.testnet');
  assert.equal(id.recovery, 'RECOVERY_PHRASE');
  const raw = storage.getItem(VAULT_STORAGE_KEY);
  assert.equal(JSON.parse(raw).version, 2);
  assert.equal(JSON.parse(raw).ciphertext.length, 64);
  await assert.rejects(vault.revealRecoveryPhrase('wrong but long password'), { code: 'BAD_PASSWORD_OR_DATA' });
  const words = await vault.revealRecoveryPhrase(password);
  assert.equal(words.length, 12);
  for (const w of words) { assert.ok(BIP39_ENGLISH.includes(w)); assert.equal(raw.includes(w + ' '), false); }
  assert.equal(vault.unlocked, false);
  const other = new EncryptedTestnetVault(memory());
  const restored = await other.restoreFromRecoveryPhrase(words, 'another device password', 'phrase-owner.testnet');
  assert.deepEqual(restored, id);
  // Rebinding to another name keeps the same phrase and key.
  const renamed = await vault.rebindAccount(password, 'renamed.testnet');
  assert.equal(renamed.publicKeyHex, id.publicKeyHex);
  assert.deepEqual(await vault.revealRecoveryPhrase(password), words);
});

test('invalid phrases are refused without writing anything', async () => {
  const abandon = Array(12).fill('abandon');
  for (const bad of [abandon.join(' '), abandon.slice(0, 11).join(' ') + ' notaword', 'abandon about', VECTORS[0][0] + ' about']) {
    const vault = new EncryptedTestnetVault(memory());
    await assert.rejects(vault.restoreFromRecoveryPhrase(bad, password), { code: 'INVALID_PHRASE' });
    assert.equal(vault.getIdentity(), null);
  }
  const vault = new EncryptedTestnetVault(memory());
  await assert.rejects(vault.restoreFromRecoveryPhrase(VECTORS[0][0], password, 'x.near'), { code: 'INVALID_ACCOUNT_ID' });
  await assert.rejects(vault.restoreFromRecoveryPhrase(VECTORS[0][0], 'short'), { code: 'PASSWORD_POLICY' });
});

test('legacy v1 (random key, encrypted-file backup) vaults still unlock; they have no phrase to reveal', async () => {
  const c = webcrypto;
  const pair = await c.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyHex = Buffer.from(await c.subtle.exportKey('raw', pair.publicKey)).toString('hex');
  const salt = c.getRandomValues(new Uint8Array(16)); const iv = c.getRandomValues(new Uint8Array(12));
  const meta = { version: 1, network: 'near-testnet', algorithm: 'Ed25519', publicKeyHex, accountId: publicKeyHex,
    kdf: 'PBKDF2-SHA256', iterations: 600000, cipher: 'AES-256-GCM', salt: Buffer.from(salt).toString('hex'), iv: Buffer.from(iv).toString('hex') };
  const material = await c.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await c.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const pkcs8 = await c.subtle.exportKey('pkcs8', pair.privateKey);
  const ct = await c.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(JSON.stringify(meta)), tagLength: 128 }, key, pkcs8);
  const storage = memory(); storage.setItem(VAULT_STORAGE_KEY, JSON.stringify({ ...meta, ciphertext: Buffer.from(ct).toString('hex') }));
  const vault = new EncryptedTestnetVault(storage);
  assert.equal(vault.getIdentity().recovery, 'ENCRYPTED_FILE');
  assert.equal((await vault.unlock(password)).publicKeyHex, publicKeyHex);
  await assert.rejects(vault.revealRecoveryPhrase(password), { code: 'NO_RECOVERY_PHRASE' });
  const renamed = await vault.rebindAccount(password, 'legacy.testnet');
  assert.equal(JSON.parse(storage.getItem(VAULT_STORAGE_KEY)).version, 1);
  assert.equal((await vault.unlock(password)).accountId, renamed.accountId);
});

test('recoveryPhrasePublicKeyHex previews the key without storing anything', async () => {
  const { recoveryPhrasePublicKeyHex } = await import('../dist/recovery-phrase.js');
  assert.equal(await recoveryPhrasePublicKeyHex(webcrypto, VECTORS[1][0]), keyHex(VECTORS[1][1]));
  assert.equal(await recoveryPhrasePublicKeyHex(webcrypto, 'abandon '.repeat(12)), null);
});
