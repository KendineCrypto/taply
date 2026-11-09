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
