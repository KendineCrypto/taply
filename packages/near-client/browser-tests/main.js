import { actions, createTransaction, PublicKey, baseEncode, encodeTransaction } from 'near-api-js';
import { EncryptedTestnetVault, signVaultTransaction } from '../dist/wallet-vault.js';
import { ed25519PublicKeyFromHex } from '../dist/wallet-chain.js';

// This test never reads a user's storage. The key and synthetic signature are
// discarded with this isolated context; no signature or private data is logged.
async function check() {
  let privateExportsBlocked = false;
  let privateExportAttempts = 0;
  let allSigningKeysNonextractable = true;
  let networkAttempts = 0;
  const original = globalThis.crypto;
  globalThis.fetch = async () => { networkAttempts++; throw Error('Network disabled in offline test'); };
  const subtle = new Proxy(original.subtle, { get(target, name) {
    if (name === 'exportKey') return async (format, key) => {
      if (privateExportsBlocked && key.type === 'private') { privateExportAttempts++; throw Error('Private key export forbidden'); }
      return target.exportKey(format, key);
    };
    if (name === 'sign') return async (...args) => {
      allSigningKeysNonextractable &&= args[1].extractable === false;
      return target.sign(...args);
    };
    const value = Reflect.get(target, name, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const crypto = { subtle, getRandomValues: original.getRandomValues.bind(original), randomUUID: original.randomUUID.bind(original) };
  const memory = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };
  const vault = new EncryptedTestnetVault(memory(), { crypto });
  const password = 'synthetic-browser-test-passphrase';
  const identity = await vault.create(password);
  privateExportsBlocked = true;
  await vault.unlock(password);
  const tx = createTransaction(identity.accountId, PublicKey.fromString(ed25519PublicKeyFromHex(identity.publicKeyHex)),
    'offline-receiver.testnet', 1n, [actions.transfer(100000000000000000000000n)], new Uint8Array(32));
  const signed = await signVaultTransaction(vault, tx);
  const hash = new Uint8Array(await original.subtle.digest('SHA-256', new Uint8Array(encodeTransaction(tx))));
  if (baseEncode(hash) !== baseEncode(signed.txHash) || !tx.publicKey.verify(hash, signed.signedTransaction.signature.data)) throw Error('SDK signature/hash mismatch');
  const backup = vault.exportEncryptedBackup(); vault.lock();
  let lockedRejected = false;
  try { await signVaultTransaction(vault, tx); } catch { lockedRejected = true; }
  const restored = new EncryptedTestnetVault(memory(), { crypto });
  const recovered = await restored.restoreEncryptedBackup(backup, password);
  const recoveredLocked = !restored.unlocked;
  await restored.unlock(password); await signVaultTransaction(restored, tx); restored.lock();
  const webLock = await navigator.locks.request('taply-offline-compatibility', { mode: 'exclusive' }, async () => true);
  if (networkAttempts || privateExportAttempts || !allSigningKeysNonextractable || !lockedRejected || !recoveredLocked || recovered.accountId !== identity.accountId || !webLock)
    throw Error('Security compatibility check failed');
  return { secureContext: isSecureContext, ed25519: true, sdkSignatureAndHash: true, nonextractable: true,
    privateExportAttempts, lockedRejected, encryptedRecovery: true, webLocks: webLock, networkAttempts,
    userAgent: navigator.userAgent, evidence: 'OFFLINE_SYNTHETIC_NOT_TESTNET' };
}
window.__taplyWalletCheck = check().then(result => {
  document.querySelector('#result').textContent = JSON.stringify(result, null, 2); return result;
}, error => {
  const result = { failure: error.name + ': ' + error.message, evidence: 'OFFLINE_SYNTHETIC_NOT_TESTNET' };
  document.querySelector('#result').textContent = JSON.stringify(result); return result;
});
