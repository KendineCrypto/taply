// NEAR TESTNET automation for Taply evidence runs. Disposable, automation-owned
// accounts only: created through the public Testnet faucet helper, keys kept
// OUTSIDE the repository (TAPLY_E2E_KEY_DIR, default ~/.taply-automation, 0600).
// Never used with owner wallets. Never prints secret keys.
//
// Run with Node 24 and, behind an HTTPS proxy:
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<proxy CA> node <script>.mjs
import { Account, KeyPair } from 'near-api-js';
import { calculateRequestId, calculateTermsHash } from '@taply/shared';
import { TESTNET_GENESIS_HASH } from '../dist/index.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
const require_fs = () => ({ readdirSync });
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export const RPC = process.env.TAPLY_E2E_RPC ?? 'https://rpc.testnet.near.org';
export const KEY_DIR = process.env.TAPLY_E2E_KEY_DIR ?? `${homedir()}/.taply-automation`;
export const TGAS = 1_000_000_000_000n;
export const NEAR = 1_000_000_000_000_000_000_000_000n;

let rpcId = 0;
export async function rpc(method, params) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `taply-e2e-${++rpcId}`, method, params }) });
  const body = await res.json();
  if (body.error) { const e = new Error(`RPC ${method}: ${JSON.stringify(body.error).slice(0, 400)}`); e.rpc = body.error; throw e; }
  return body.result;
}

/** Refuse to run anywhere but NEAR Testnet (genesis hash pinned in near-client). */
export async function assertTestnet() {
  const s = await rpc('status', []);
  if (s.chain_id !== 'testnet' || s.genesis_hash !== TESTNET_GENESIS_HASH) throw new Error('NOT_TESTNET');
}

export async function finalBlock() {
  const b = await rpc('block', { finality: 'final' });
  return { hash: b.header.hash, height: b.header.height, timestampNs: BigInt(b.header.timestamp_nanosec) };
}

export async function view(contractId, method, args = {}) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contractId, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  // A contract panic inside a view comes back as result.error, not as an RPC error.
  if (r.error) throw new Error(`view ${method}: ${String(r.error).slice(0, 300)}`);
  return JSON.parse(Buffer.from(r.result).toString('utf8'));
}

export async function viewAccount(accountId) {
  return rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
}

function keyPath(id) { return `${KEY_DIR}/${id}.json`; }

export function loadAccount(id) {
  const { accountId, secretKey } = JSON.parse(readFileSync(keyPath(id), 'utf8'));
  return new Account(accountId, RPC, secretKey);
}

/** Creates a fresh `taply-e2e-*.testnet` account funded by the public Testnet faucet (10 test NEAR). */
export async function createFaucetAccount(prefix = 'taply-e2e') {
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const id = `${prefix}-${randomBytes(4).toString('hex')}.testnet`;
  const kp = KeyPair.fromRandom('ed25519');
  const res = await fetch('https://helper.testnet.near.org/account', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
  if (!res.ok) throw new Error(`faucet ${res.status}`);
  writeFileSync(keyPath(id), JSON.stringify({ accountId: id, secretKey: kp.toString() }), { mode: 0o600 });
  for (let i = 0; i < 20; i++) {
    try { await viewAccount(id); return id; } catch { await sleep(1500); }
  }
  throw new Error('faucet account never appeared');
}

/** Role -> account mapping, persisted next to the keys so reruns reuse funded accounts. */
export async function roleAccount(role) {
  const file = `${KEY_DIR}/roles.json`;
  const roles = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (roles[role] && existsSync(keyPath(roles[role]))) return roles[role];
  roles[role] = await createFaucetAccount();
  writeFileSync(file, JSON.stringify(roles, null, 2), { mode: 0o600 });
  return roles[role];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** FINAL execution outcome with every receipt (EXPERIMENTAL_tx_status). */
export async function finalTx(hash, signerId) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await rpc('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: signerId, wait_until: 'FINAL' });
      if (r.final_execution_status === 'FINAL') return r;
    } catch (e) { if (!/UNKNOWN_TRANSACTION|TIMEOUT|timeout/i.test(e.message)) throw e; }
    await sleep(2000);
  }
  throw new Error(`tx ${hash} never FINAL`);
}

export function failureOf(outcome) {
  const failures = [outcome.transaction_outcome, ...outcome.receipts_outcome]
    .map((o) => o.outcome.status.Failure).filter(Boolean);
  return failures.length ? JSON.stringify(failures[0]) : null;
}

/** Sends one function call and returns its FINAL outcome (never throws on contract failure). */
export async function call(account, contractId, methodName, args, { deposit = 0n, gas = 30n * TGAS } = {}) {
  const { actions } = await import('near-api-js');
  const sent = await account.signAndSendTransaction({ receiverId: contractId, waitUntil: 'EXECUTED_OPTIMISTIC', throwOnFailure: false,
    actions: [actions.functionCall(methodName, args, gas, deposit)] });
  const hash = sent.transaction_outcome?.id ?? sent.transaction?.hash;
  const outcome = await finalTx(hash, account.accountId);
  return { hash, outcome, failure: failureOf(outcome), gasBurnt: [outcome.transaction_outcome, ...outcome.receipts_outcome]
    .reduce((s, o) => s + BigInt(o.outcome.gas_burnt), 0n).toString() };
}

/** Immutable taply.intent.v1 terms; expiry anchored to a FINAL block, never the local clock. */
export function buildTerms({ contractId, creator, amount, mode = 'instant', cancelDurationNs = null, nowNs,
  lifetimeNs = 900_000_000_000n, assetId = 'near:native', permittedPayer = null, memo = '' }) {
  const creationNonce = randomBytes(32).toString('hex');
  const id = calculateRequestId({ contractId, creationNonce, creatorAccountId: creator, network: 'near-testnet' });
  const terms = { schemaVersion: 'taply.intent.v1', id, network: 'near-testnet', contractId, creationNonce, creatorAccountId: creator,
    assetId, amountBaseUnits: amount.toString(), mode, cancelDurationNs, fundingExpiresAtNs: (nowNs + lifetimeNs).toString(),
    permittedPayerAccountId: permittedPayer, merchantAccountId: null, memo, sessionBinding: null };
  return { terms, termsHash: calculateTermsHash(terms) };
}

export function writeEvidence(path, value) {
  const text = JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  // Refuse if any automation secret key would leak into the evidence file.
  const { readdirSync } = require_fs();
  for (const f of readdirSync(KEY_DIR).filter((n) => n.endsWith('.testnet.json'))) {
    const { secretKey } = JSON.parse(readFileSync(`${KEY_DIR}/${f}`, 'utf8'));
    if (text.includes(secretKey) || text.includes(secretKey.replace(/^ed25519:/, ''))) throw new Error('refusing to write a secret key');
  }
  writeFileSync(path, `${text}\n`, { flag: 'wx' });
}
