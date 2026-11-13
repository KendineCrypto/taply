import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EncryptedMainnetVault, EncryptedTestnetVault, MAINNET_WALLET_STORAGE_KEY,
  createMainnetAttemptJournal, prepareMainnetNativeTransfer, prepareMainnetUsdcTransfer } from '../dist/index.js';
import { signMainnetVaultTransaction } from '../dist/mainnet-vault.js';
const password = 'local-synthetic-password';
const storage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k,v) }; };
test('Mainnet phrase roundtrip, encrypted backup isolation and closed signer', async () => {
  const data = storage(); const vault = new EncryptedMainnetVault(data);
  const identity = await vault.create(password);
  assert.equal(identity.network, 'near-mainnet'); assert.equal(identity.provisioning, 'LOCAL_ONLY');
  assert.equal(identity.accountId, identity.publicKeyHex);
  const words = await vault.revealRecoveryPhrase(password); assert.equal(words.length, 12);
  const restored = new EncryptedMainnetVault(storage());
  assert.deepEqual(await restored.restoreFromRecoveryPhrase(words, password), identity);
  const backup = vault.exportEncryptedBackup();
  assert.equal(backup.includes(words.join(' ')), false); assert.equal(vault.unlocked, false);
  await vault.unlock(password);
  await assert.rejects(signMainnetVaultTransaction(vault, {}), { code: 'SIGNING_DISABLED' });
  const testnet = new EncryptedTestnetVault(storage());
  await assert.rejects(testnet.restoreEncryptedBackup(backup, password));
  await testnet.create(password);
  await assert.rejects(new EncryptedMainnetVault(storage()).restoreEncryptedBackup(testnet.exportEncryptedBackup(), password));
  const forged = JSON.parse(testnet.exportEncryptedBackup()); forged.network = 'near-mainnet';
  await assert.rejects(new EncryptedMainnetVault(storage()).restoreEncryptedBackup(JSON.stringify(forged), password));
  data.setItem(MAINNET_WALLET_STORAGE_KEY, testnet.exportEncryptedBackup());
  assert.equal(vault.unlocked, false);
  vault.lock(); restored.lock(); words.fill('');
});
test('Mainnet vault rejects Testnet named accounts and interrupted unlock', async () => {
  const vault = new EncryptedMainnetVault(storage());
  for (const id of ['alice.testnet','alice.test']) await assert.rejects(vault.create(password,id));
  await vault.create(password); const pending = vault.unlock(password); vault.lock();
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(vault.unlocked, false);
});
const snapshot = { network:'near-mainnet', accountId:'alice.near', publicKey:'ed25519:11111111111111111111111111111111',
  nonce:'0', blockHash:'11111111111111111111111111111111', blockHeight:'1', blockTimestampNs:'1',
  amountYocto:'10000000000000000000000000', storageUsageBytes:'100', storageByteCostYocto:'10000000000000000000', gasPriceYocto:'100000000' };
test('Mainnet builders preserve exact amounts, budgets, registration and block bindings', () => {
  assert.equal(prepareMainnetNativeTransfer(snapshot,'bob.near','0.000000000000000000000001').depositYocto,'1');
  for (const amount of ['1e-6','0','-1','1.0000000000000000000000001']) assert.throws(() => prepareMainnetNativeTransfer(snapshot,'bob.near',amount));
  assert.throws(() => prepareMainnetNativeTransfer({...snapshot,network:'near-testnet'},'bob.near','1'));
  assert.throws(() => prepareMainnetNativeTransfer(snapshot,'bob.testnet','1'));
  assert.throws(() => prepareMainnetNativeTransfer(snapshot,'bob.near','10'));
  const input = { snapshot, receiverId:'bob.near', amountBaseUnits:'25000000', tokenEvidence:{ blockHash:snapshot.blockHash, accountId:snapshot.accountId,
    receiverId:'bob.near', balance:'25000000', senderRegistered:true, receiverRegistered:true } };
  assert.equal(prepareMainnetUsdcTransfer(input).depositYocto,'1');
  assert.equal(prepareMainnetUsdcTransfer(input).args.amount,'25000000');
  for (const edit of [{receiverRegistered:false},{senderRegistered:false},{balance:'24999999'},{accountId:'mallory.near'},{blockHash:'wrong'}])
    assert.throws(() => prepareMainnetUsdcTransfer({...input,tokenEvidence:{...input.tokenEvidence,...edit}}));
});
test('atomic reservations, stale fencing, crash/restart and lost acknowledgements block a second payment', async () => {
  const records = new Map();
  const store = { read: async k => records.get(k) ?? null, compareAndSwap: async (k,old,next) => {
    if ((records.get(k) ?? null) !== old) return false; records.set(k,next); return true;
  } };
  const journal = createMainnetAttemptJournal(store);
  const results = await Promise.allSettled(Array.from({length:20},()=>journal.reserve('alice.near','a'.repeat(64))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const reserved = await journal.read('alice.near');
  const handoff = await journal.transition(reserved,'HANDOFF');
  await assert.rejects(journal.transition(reserved,'HANDOFF'), /STALE_ATTEMPT/);
  const restarted = createMainnetAttemptJournal(store);
  assert.deepEqual(await restarted.read('alice.near'),handoff);
  await assert.rejects(restarted.reserve('alice.near','b'.repeat(64)),/OUTCOME_UNRESOLVED/);
  await restarted.transition(handoff,'UNCERTAIN');
  await assert.rejects(restarted.reserve('alice.near','c'.repeat(64)),/OUTCOME_UNRESOLVED/);
  const lost = createMainnetAttemptJournal({...store,compareAndSwap:async (...args)=>{await store.compareAndSwap(...args);throw Error('lost ack');}});
  await assert.rejects(lost.reserve('bob.near','d'.repeat(64)),/lost ack/);
  await assert.rejects(restarted.reserve('bob.near','e'.repeat(64)),/OUTCOME_UNRESOLVED/);
});
