// Fully synthetic RPC and disposable in-memory keys. Never contacts a chain.
import assert from 'node:assert/strict';
import { SignedTransaction, base64Decode, base64Encode, baseEncode, encodeTransaction } from 'near-api-js';
import { EncryptedTestnetVault } from '../dist/wallet-vault.js';
import { createReviewedWalletBackend } from '../dist/wallet-backend.js';
import { createWalletChain } from '../dist/wallet-chain.js';
import { WalletAttemptJournal } from '../dist/wallet-journal.js';
import { buildClient } from '../dist/client.js';
import { TESTNET_GENESIS_HASH } from '../dist/index.js';
import { HASH, HASH2 } from './helpers.mjs';

export const PASSWORD = 'synthetic-offline-only-passphrase';
export async function signerFixture() {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const state = { now: Date.now(), nonce: 7, amount: '10000000000000000000000000', enabled: true,
    network: 'testnet', mode: 'ok', failed: false, corruptSignature: false, refuseExports: false,
    exportAttempts: 0, signs: 0, nonextractable: true, calls: [], sends: 0, tx: null, locked: false, dropHistory: false, forgeAction: false, views: {} };
  const subtle = new Proxy(crypto.subtle, { get(target, property) {
    if (property === 'exportKey') return async (format, key) => {
      if (state.refuseExports && key.type === 'private') { state.exportAttempts++; throw Error('Private export forbidden'); }
      return target.exportKey(format, key);
    };
    if (property === 'sign') return async (...args) => {
      state.signs++; state.nonextractable &&= args[1].extractable === false;
      const signed = new Uint8Array(await target.sign(...args));
      if (state.corruptSignature) signed[0] ^= 1;
      return signed.buffer;
    };
    const method = Reflect.get(target, property, target);
    return typeof method === 'function' ? method.bind(target) : method;
  } });
  const guardedCrypto = { subtle, getRandomValues: crypto.getRandomValues.bind(crypto), randomUUID: crypto.randomUUID.bind(crypto) };
  const vault = new EncryptedTestnetVault(storage, { crypto: guardedCrypto, now: () => state.now });
  const identity = await vault.create(PASSWORD); state.refuseExports = true; await vault.unlock(PASSWORD); state.signs = 0;
  const journal = new WalletAttemptJournal(storage);
  const config = { network: 'near-testnet', rpcUrl: 'https://rpc.unit.invalid', rpcProviderId: 'synthetic-offline', contract: null, timeoutMs: 1000 };
  const outcome = (id, executor, status, receipt_ids = []) => ({ id, block_hash: HASH, outcome: {
    executor_id: executor, status, receipt_ids, logs: [], gas_burnt: 1000, tokens_burnt: '0',
  } });
  const txResponse = () => {
    const tx = state.tx.transaction;
    const hash = baseEncode(state.hash);
    const status = state.failed ? { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: tx.receiverId } } } } } : { SuccessValue: '' };
    const rpcActions = tx.actions.map((action) => action.transfer ? { Transfer: { deposit: action.transfer.deposit.toString() } } : { FunctionCall: {
      method_name: action.functionCall.methodName, args: base64Encode(new Uint8Array(action.functionCall.args)), gas: Number(action.functionCall.gas), deposit: action.functionCall.deposit.toString(),
    } });
    const rpcAction = rpcActions[0];
    if (state.forgeAction && rpcAction.Transfer) rpcAction.Transfer.deposit = '2';
    if (state.forgeAction && rpcAction.FunctionCall && rpcActions.length > 1) rpcAction.FunctionCall.deposit = '2';
    return { final_execution_status: 'FINAL', status,
      transaction: { hash, signer_id: tx.signerId, receiver_id: tx.receiverId, public_key: tx.publicKey.toString(), nonce: Number(tx.nonce), actions: rpcActions },
      transaction_outcome: outcome(hash, tx.signerId, { SuccessReceiptId: HASH2 }, [HASH2]),
      receipts_outcome: [outcome(HASH2, tx.receiverId, status)], receipts: [],
    };
  };
  const fetcher = async (url, init) => {
    assert.equal(url, config.rpcUrl); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const request = JSON.parse(init.body); state.calls.push(request);
    let result;
    if (request.method === 'send_tx') {
      state.sends++;
      assert.equal(journal.read().phase, 'SUBMITTED');
      assert.equal(request.params.wait_until, 'FINAL');
      state.tx = SignedTransaction.decode(base64Decode(request.params.signed_tx_base64));
      state.hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encodeTransaction(state.tx.transaction)));
      assert.equal(journal.read().transactionHash, baseEncode(state.hash));
      assert.equal(journal.read().unsignedTransaction, base64Encode(encodeTransaction(state.tx.transaction)));
      assert.equal(state.tx.transaction.publicKey.verify(state.hash, new Uint8Array(state.tx.signature.ed25519Signature.data)), true);
      if (state.mode === 'timeout') return new Promise(() => {});
      if (state.mode === 'body_timeout') return new Response(new ReadableStream({ start() {}, cancel() { state.bodyCancelled = true; } }));
      if (state.mode === 'http503') return new Response('unavailable', { status: 503 });
      if (state.mode === 'stale_nonce') return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32000, cause: { name: 'INVALID_TRANSACTION' } } });
      result = txResponse();
    } else if (request.method === 'status') result = { chain_id: state.network, genesis_hash: TESTNET_GENESIS_HASH, version: { version: 'synthetic' }, sync_info: { syncing: false } };
    else if (request.method === 'block') result = { header: { hash: HASH, height: 100, timestamp_nanosec: (BigInt(state.now) * 1_000_000n).toString() } };
    else if (request.method === 'EXPERIMENTAL_protocol_config') result = { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
    else if (request.method === 'gas_price') result = { gas_price: '100000000' };
    else if (request.method === 'query') {
      if (request.params.request_type === 'view_access_key') result = { nonce: state.nonce, permission: 'FullAccess', block_hash: HASH, block_height: 100 };
      else if (request.params.request_type === 'call_function') result = { result: [...new TextEncoder().encode(JSON.stringify(state.views[request.params.method_name] ?? null))], logs: [], block_hash: HASH, block_height: 100 };
      else result = { amount: state.amount, locked: '0', storage_usage: 182, code_hash: request.params.account_id === config.contract?.accountId ? config.contract.expectedCodeHash : HASH, block_hash: HASH, block_height: 100 };
    } else if (request.method === 'EXPERIMENTAL_tx_status' || request.method === 'tx_status') {
      assert.equal(request.params.tx_hash, journal.read().transactionHash);
      if (state.dropHistory) return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32000, cause: { name: 'UNKNOWN_TRANSACTION' } } });
      result = txResponse();
    } else throw Error(`Unexpected synthetic method ${request.method}`);
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  const chain = createWalletChain(config, fetcher);
  const reader = buildClient(config, fetcher, false, () => new Date(state.now));
  // This lock is local to the isolated fixture. Browser tests verify Web Locks.
  const policy = { signingPermitted: () => state.enabled, contractCallsPermitted: () => state.enabled,
    withExclusiveLock: async task => { assert.equal(state.locked, false); state.locked = true; try { return await task(); } finally { state.locked = false; } } };
  const makeBackend = () => createReviewedWalletBackend({ config, vault, storage, policy, chain, reader, fetcher, crypto: guardedCrypto, now: () => state.now });
  return { state, vault, storage, values, identity, journal, makeBackend, backend: makeBackend(), guardedCrypto, fetcher, config, chain, reader, policy, txResponse };
}
