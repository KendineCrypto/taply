#!/usr/bin/env node
/**
 * Build-time network isolation guard for the NEAR MAINNET deployment
 * (docs/MAINNET_BRIEF.md §8.1, docs/MAINNET_INFRA.md §4).
 *
 * Why it exists: `apps/web/.env.production` is committed and holds NEAR
 * Testnet values, and several runtime defaults (RPC, explorer, verifier
 * fallback) are Testnet URLs. Next.js loads that file into every production
 * build, so a mainnet Vercel project that forgets to override one key would
 * silently ship a Testnet value inside a mainnet bundle. This guard resolves
 * the environment exactly as `next build` will (process env first, then
 * .env.production.local, .env.local, .env.production, .env) and refuses the
 * build if anything points at Testnet, at the staging contract in
 * production, at the owner's recovery account, or at the Testnet host.
 *
 * It never prints a server-only value (tokens, Redis URLs); public
 * NEXT_PUBLIC_* values are printed because they ship to the browser anyway.
 *
 * It does nothing for a Testnet build: the Testnet deployment must behave
 * exactly as before (brief §2.3). `--require-mainnet` makes a non-mainnet
 * network an error; the mainnet Vercel project's build command uses it.
 *
 * Usage (from apps/web):
 *   node scripts/check-mainnet-env.mjs --require-mainnet   # mainnet project
 *   node scripts/check-mainnet-env.mjs                     # no-op unless mainnet
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Owner-confirmed values, 2026-11-13 (docs/MAINNET_BRIEF.md §0). */
export const MAINNET = Object.freeze({
  network: 'near-mainnet',
  hostname: 'mainnet.taplyapp.xyz',
  shareOrigin: 'https://mainnet.taplyapp.xyz',
  productionContract: 'taply-pay.kendinecrypto.near',
  stagingContract: 'devkendinecrypto.near',
  recoveryAccount: 'kendinecrypto.near',
  explorer: 'https://nearblocks.io',
  /** Verified to answer browser fetch cross-origin (brief §3). */
  rpcHosts: Object.freeze(['rpc.mainnet.fastnear.com', 'rpc.mainnet.near.org', 'archival-rpc.mainnet.fastnear.com']),
});

/** Origins that serve the Testnet build. A mainnet link must never open there. */
export const TESTNET_ORIGINS = Object.freeze(['https://taplyapp.xyz', 'https://www.taplyapp.xyz']);

/** Code hashes of the Testnet contracts. Never valid on a mainnet build. */
export const TESTNET_CODE_HASHES = Object.freeze([
  '963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84', // payments-protected on Testnet
  'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B', // G1 pilot on Testnet
]);

/** Any of these in a Taply value means the value belongs to Testnet. */
const TESTNET_MARKERS = [/testnet/i, /(^|[/.])test\.rpc\./i, /\.test(?=$|[/:])/i];

/** Keys whose values are server-only and must never be printed. */
const SECRET_KEY = /TOKEN|SECRET|PASSWORD|PRIVATE|API_KEY|_URL$/;

/** Next.js production env file precedence, highest first. */
export const ENV_FILES = Object.freeze(['.env.production.local', '.env.local', '.env.production', '.env']);

/**
 * Minimal dotenv parser matching how this repository writes env files:
 * KEY=VALUE, optional surrounding quotes, `#` comments. Variable expansion
 * (`$NAME`) is reported as an error rather than guessed, because Next.js
 * would expand it and this guard would then check a different value.
 */
export function parseEnvFile(text) {
  const values = {};
  const problems = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      problems.push(`line ${index + 1}: not KEY=VALUE`);
      continue;
    }
    let value = match[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim();
    if (value.includes('$') && (!quoted || quoted[1] === '"')) problems.push(`${match[1]}: variable expansion is not supported`);
    values[match[1]] = value;
  }
  return { values, problems };
}

/**
 * The environment `next build` will see: process env wins, then the files in
 * ENV_FILES order. Returns the merged map and, per key, where it came from.
 */
export function resolveBuildEnv(processEnv, files) {
  const merged = {};
  const source = {};
  const problems = [];
  for (const name of [...ENV_FILES].reverse()) {
    const text = files[name];
    if (text === undefined) continue;
    const parsed = parseEnvFile(text);
    for (const p of parsed.problems) problems.push(`${name} ${p}`);
    for (const [key, value] of Object.entries(parsed.values)) {
      merged[key] = value;
      source[key] = name;
    }
  }
  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    merged[key] = value;
    source[key] = 'process env (hosting dashboard)';
  }
  return { env: merged, source, problems };
}

function hostOf(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.hostname : null;
  } catch {
    return null;
  }
}

const isTaplyKey = (key) => key.startsWith('NEXT_PUBLIC_TAPLY_') || key.startsWith('TAPLY_');
const set = (value) => typeof value === 'string' && value.trim() !== '';
const on = (value) => value === 'on';

/**
 * Pure evaluation. `env` is the merged build env, `source` says where each key
 * came from, `vercelEnv` is VERCEL_ENV ('production' | 'preview' | 'development'
 * | undefined for a local build). Returns { mainnet, checks }.
 */
export function evaluateMainnetEnv({ env, source = {}, vercelEnv, requireMainnet = false }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
  const network = env.NEXT_PUBLIC_TAPLY_NETWORK;

  if (network !== MAINNET.network) {
    if (requireMainnet) {
      add('network is near-mainnet', false, `NEXT_PUBLIC_TAPLY_NETWORK is ${JSON.stringify(network ?? null)}; the mainnet project must set near-mainnet`);
    }
    return { mainnet: false, checks };
  }
  add('network is near-mainnet', true);
  const production = vercelEnv === 'production';

  // 1. Nothing Taply-related may name Testnet, from any source.
  const testnetValues = Object.entries(env)
    .filter(([key, value]) => isTaplyKey(key) && typeof value === 'string' && TESTNET_MARKERS.some((m) => m.test(value)))
    .map(([key]) => (source[key] ? `${key} (from ${source[key]})` : key));
  add('no Testnet account, RPC or explorer in any TAPLY value', testnetValues.length === 0, `Testnet values: ${testnetValues.join(', ')}`);

  const knownTestnetHash = ['NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH', 'NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH'].filter((key) =>
    TESTNET_CODE_HASHES.includes(env[key]),
  );
  add('no Testnet contract code hash', knownTestnetHash.length === 0, `Testnet code hash in ${knownTestnetHash.join(', ')}`);

  // 2. RPCs must be set explicitly: the runtime defaults are Testnet URLs.
  const rpc = env.NEXT_PUBLIC_TAPLY_RPC_URL;
  add('RPC set explicitly to an approved mainnet host', set(rpc) && MAINNET.rpcHosts.includes(hostOf(rpc)), `NEXT_PUBLIC_TAPLY_RPC_URL must be https:// on ${MAINNET.rpcHosts.join(' | ')}`);
  add('RPC provider id set', set(env.NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID), 'NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID must be set (the default names Testnet)');
  for (const [urlKey, idKey] of [
    ['NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL', 'NEXT_PUBLIC_TAPLY_VERIFIER_RPC_PROVIDER_ID'],
    ['NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_URL', 'NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_PROVIDER_ID'],
  ]) {
    const url = env[urlKey];
    const fallbackOff = urlKey.includes('FALLBACK') && url === 'off';
    const required = urlKey.includes('FALLBACK'); // unset fallback defaults to a Testnet archival node
    const ok = fallbackOff || (!set(url) && !required) || (set(url) && MAINNET.rpcHosts.includes(hostOf(url)) && set(env[idKey]));
    add(`${urlKey} is a mainnet host${required ? " or 'off'" : ' or unset'}`, ok, `${urlKey} must be https:// on ${MAINNET.rpcHosts.join(' | ')} with ${idKey}${required ? ", or 'off' (unset falls back to a Testnet archival node)" : ''}`);
  }

  // 3. Explorer must be set explicitly: the default is testnet.nearblocks.io.
  const explorer = (env.NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL ?? '').replace(/\/+$/, '');
  add('explorer is https://nearblocks.io', explorer === MAINNET.explorer, `NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL must be ${MAINNET.explorer}`);

  // 4. Contract accounts.
  const allowedContracts = production ? [MAINNET.productionContract] : [MAINNET.productionContract, MAINNET.stagingContract];
  for (const [idKey, hashKey] of [
    ['NEXT_PUBLIC_TAPLY_CONTRACT_ID', 'NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH'],
    ['NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID', 'NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH'],
  ]) {
    const id = env[idKey];
    if (!set(id) && !set(env[hashKey])) {
      add(`${idKey} unset (contract features stay off)`, true);
      continue;
    }
    add(`${idKey} is never the recovery account`, id !== MAINNET.recoveryAccount, `${idKey} is the owner's recovery account ${MAINNET.recoveryAccount}`);
    add(
      `${idKey} is ${production ? 'the production contract' : 'the staging or production contract'}`,
      allowedContracts.includes(id),
      `${idKey}=${JSON.stringify(id ?? null)}; allowed on ${production ? 'Production' : 'this build'}: ${allowedContracts.join(', ')}`,
    );
    add(`${hashKey} set together with ${idKey}`, set(id) && set(env[hashKey]), `${idKey} and ${hashKey} must be set together`);
  }

  // 5. Flags that sign must have a pinned contract.
  for (const [flag, idKey, hashKey] of [
    ['NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY', 'NEXT_PUBLIC_TAPLY_CONTRACT_ID', 'NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH'],
    ['NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY', 'NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID', 'NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH'],
  ]) {
    if (on(env[flag])) add(`${flag}=on has a pinned contract`, set(env[idKey]) && set(env[hashKey]), `${flag}=on needs ${idKey} and ${hashKey}`);
  }
  if (production) {
    add('Protected QA mode off on Production', !on(env.NEXT_PUBLIC_TAPLY_PROTECTED_QA), 'NEXT_PUBLIC_TAPLY_PROTECTED_QA must not be on in Production (it is on in .env.production)');
  }

  // 5b. Mainnet integration switches (docs/MAINNET_1CLICK_INTEGRATION.md).
  //     Fixtures and fixture-signed 1Click quotes never reach Production; funded
  //     quotes and signing are NO-GO (also hard-gated in lib/mainnet/release-gates.ts).
  const oneClickMode = env.TAPLY_ONECLICK_MODE ?? 'off';
  add('TAPLY_ONECLICK_MODE is off, fixture or dry', ['off', 'fixture', 'dry'].includes(oneClickMode), `TAPLY_ONECLICK_MODE=${JSON.stringify(oneClickMode)}; funded quotes are not approved`);
  add('signing flag off (NO-GO for mainnet funds)', !on(env.NEXT_PUBLIC_TAPLY_MAINNET_SIGNING), 'NEXT_PUBLIC_TAPLY_MAINNET_SIGNING must stay off until the owner-approved release review');
  if (production) {
    add('fixtures off on Production', !on(env.NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES), 'NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES must not be on in Production');
    add('1Click fixture mode off on Production', oneClickMode !== 'fixture', 'TAPLY_ONECLICK_MODE=fixture is refused in Production');
    // No Mainnet Gift account/fee/limits are owner-approved (docs/MAINNET_PROTOCOL_PHASE2.md "Gift").
    add('Mainnet escrow not configured on Production (not deployed/approved)', !set(env.NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID), 'NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID must stay unset on Production until the escrow is reviewed, deployed and owner-approved');
    add('Gift contract not configured on Production (not approved)', !set(env.NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID), 'NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID must stay unset on Production until the Gift account, fee and limits are owner-approved');
  }

  // 6. Share origin: never the Testnet host; exactly the mainnet host on Production.
  const share = (env.NEXT_PUBLIC_TAPLY_SHARE_ORIGIN ?? '').replace(/\/+$/, '');
  add('share origin is not the Testnet host', !TESTNET_ORIGINS.includes(share), `NEXT_PUBLIC_TAPLY_SHARE_ORIGIN=${share} serves the Testnet build`);
  if (production) {
    add(`share origin is ${MAINNET.shareOrigin} on Production`, share === MAINNET.shareOrigin, `NEXT_PUBLIC_TAPLY_SHARE_ORIGIN must be ${MAINNET.shareOrigin}`);
  }

  // 7. Live Handshake needs its own store (separate Upstash database; the
  //    owner confirms it is not the Testnet project's, docs/MAINNET_INFRA.md §4).
  if (on(env.NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE)) {
    const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
    const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
    add('Handshake store configured for this project', set(url) && set(token) && hostOf(url) !== null, 'Handshake on needs KV_REST_API_URL (https) and KV_REST_API_TOKEN from the mainnet project\'s own Upstash database');
  }

  // 8. Nothing secret-looking may be public.
  const publicSecrets = Object.keys(env).filter((key) => key.startsWith('NEXT_PUBLIC_') && /TOKEN|SECRET|PASSWORD|PRIVATE|API_KEY|SEED|MNEMONIC/.test(key));
  add('no secret-looking NEXT_PUBLIC_ variable', publicSecrets.length === 0, `public variables that look secret: ${publicSecrets.join(', ')}`);

  return { mainnet: true, checks };
}

export function describeValue(key, value) {
  if (value === undefined) return '(unset)';
  if (SECRET_KEY.test(key) && !key.startsWith('NEXT_PUBLIC_')) return '(set, hidden)';
  return JSON.stringify(value);
}

export function readEnvFiles(dir) {
  const files = {};
  for (const name of ENV_FILES) {
    const path = join(dir, name);
    if (existsSync(path)) files[name] = readFileSync(path, 'utf8');
  }
  return files;
}

export function main(argv = process.argv.slice(2), processEnv = process.env, dir = join(dirname(fileURLToPath(import.meta.url)), '..'), log = console) {
  const requireMainnet = argv.includes('--require-mainnet');
  const { env, source, problems } = resolveBuildEnv(processEnv, readEnvFiles(dir));
  const { mainnet, checks } = evaluateMainnetEnv({ env, source, vercelEnv: processEnv.VERCEL_ENV, requireMainnet });
  for (const p of problems) checks.push({ name: 'env files parse', ok: false, detail: p });
  if (!mainnet && checks.length === 0) {
    log.log('check-mainnet-env: not a mainnet build; nothing to check.');
    return 0;
  }
  log.log(`check-mainnet-env: VERCEL_ENV=${processEnv.VERCEL_ENV ?? '(local)'} branch=${processEnv.VERCEL_GIT_COMMIT_REF ?? '(local)'}`);
  for (const key of Object.keys(env).filter(isTaplyKey).sort()) log.log(`  ${key}=${describeValue(key, env[key])}  [${source[key]}]`);
  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed++;
    log.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
  }
  if (failed > 0) {
    log.error(`check-mainnet-env: ${failed} check(s) failed. Refusing to build a mainnet bundle.`);
    return 1;
  }
  log.log('check-mainnet-env: all checks passed.');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
