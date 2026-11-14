import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAINNET,
  evaluateMainnetEnv,
  main,
  parseEnvFile,
  resolveBuildEnv,
} from '../../../../scripts/check-mainnet-env.mjs';
import type { Env } from '../../../../scripts/check-mainnet-env.mjs';

/** Deterministic checks for the mainnet build isolation guard. No network. */

const WEB = join(__dirname, '..', '..', '..', '..');
const COMMITTED_ENV_PRODUCTION = readFileSync(join(WEB, '.env.production'), 'utf8');
const MAINNET_EXAMPLE = readFileSync(join(WEB, 'env', 'mainnet.env.example'), 'utf8');
const HASH = 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf'; // a well-formed placeholder, not a real deployment

/** What the owner sets in the mainnet project's Production scope (docs/MAINNET_INFRA.md §4). */
const PRODUCTION: Env = {
  NEXT_PUBLIC_TAPLY_NETWORK: 'near-mainnet',
  NEXT_PUBLIC_TAPLY_RPC_URL: 'https://rpc.mainnet.fastnear.com',
  NEXT_PUBLIC_TAPLY_RPC_PROVIDER_ID: 'fastnear-mainnet',
  NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL: 'https://archival-rpc.mainnet.fastnear.com',
  NEXT_PUBLIC_TAPLY_VERIFIER_RPC_PROVIDER_ID: 'fastnear-archival-mainnet',
  NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_URL: 'off',
  NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL: 'https://nearblocks.io',
  NEXT_PUBLIC_TAPLY_CONTRACT_ID: 'taply-pay.kendinecrypto.near',
  NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH: HASH,
  NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID: 'taply-pay.kendinecrypto.near',
  NEXT_PUBLIC_TAPLY_PROTECTED_CODE_HASH: HASH,
  NEXT_PUBLIC_TAPLY_PROTECTED_QA: 'off',
  NEXT_PUBLIC_TAPLY_FLAG_PROTECTED_PAY: 'off',
  NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY: 'off',
  NEXT_PUBLIC_TAPLY_SHARE_ORIGIN: 'https://mainnet.taplyapp.xyz',
  VERCEL_ENV: 'production',
};

function run(processEnv: Env, files: Record<string, string> = { '.env.production': COMMITTED_ENV_PRODUCTION }) {
  const { env, source, problems } = resolveBuildEnv(processEnv, files);
  const result = evaluateMainnetEnv({ env, source, vercelEnv: processEnv['VERCEL_ENV'], requireMainnet: true });
  return { ...result, problems, failed: result.checks.filter((c) => !c.ok).map((c) => c.name) };
}

describe('Testnet builds are untouched', () => {
  it('the committed Testnet production env is not a mainnet build and produces no checks', () => {
    const { env } = resolveBuildEnv({}, { '.env.production': COMMITTED_ENV_PRODUCTION });
    expect(evaluateMainnetEnv({ env })).toEqual({ mainnet: false, checks: [] });
  });

  it('the CLI exits 0 without --require-mainnet on a Testnet env', () => {
    const silent = { log: () => {}, error: () => {} };
    expect(main([], { NEXT_PUBLIC_TAPLY_NETWORK: 'near-testnet' }, WEB, silent)).toBe(0);
  });

  it('--require-mainnet refuses a Testnet or unset network', () => {
    expect(run({}).failed).toEqual(['network is near-mainnet']);
    expect(run({ NEXT_PUBLIC_TAPLY_NETWORK: 'near-testnet' }).failed).toEqual(['network is near-mainnet']);
  });
});

describe('a correct mainnet Production env passes', () => {
  it('passes with every committed Testnet value overridden', () => {
    const r = run(PRODUCTION);
    expect(r.failed).toEqual([]);
    expect(r.mainnet).toBe(true);
  });

  it('the committed mainnet.env.example passes once its pending code hashes are filled', () => {
    const { values, problems } = parseEnvFile(MAINNET_EXAMPLE);
    expect(problems).toEqual([]);
    const filled = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' && k.endsWith('CODE_HASH') ? HASH : v]));
    expect(run({ ...filled, VERCEL_ENV: 'production' }).failed).toEqual([]);
  });
});

describe('Testnet values leaking from .env.production fail the build', () => {
  it('only setting the network leaves Testnet values in the bundle and fails', () => {
    const r = run({ NEXT_PUBLIC_TAPLY_NETWORK: 'near-mainnet', VERCEL_ENV: 'production' });
    expect(r.failed).toEqual(
      expect.arrayContaining([
        'no Testnet account, RPC or explorer in any TAPLY value',
        'no Testnet contract code hash',
        'RPC set explicitly to an approved mainnet host',
        'explorer is https://nearblocks.io',
        'Protected QA mode off on Production',
        `share origin is ${MAINNET.shareOrigin} on Production`,
      ]),
    );
    const leak = r.checks.find((c) => c.name.startsWith('no Testnet account'));
    expect(leak?.detail).toContain('NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID (from .env.production)');
  });

  it.each([
    ['NEXT_PUBLIC_TAPLY_RPC_URL', 'https://rpc.testnet.near.org'],
    ['NEXT_PUBLIC_TAPLY_RPC_URL', 'https://test.rpc.fastnear.com'],
    ['NEXT_PUBLIC_TAPLY_VERIFIER_RPC_URL', 'https://archival-rpc.testnet.fastnear.com'],
    ['NEXT_PUBLIC_TAPLY_EXPLORER_BASE_URL', 'https://testnet.nearblocks.io'],
    ['NEXT_PUBLIC_TAPLY_CONTRACT_ID', 'taply-pay-pilot-1.testnet'],
  ])('%s=%s fails', (key, value) => {
    expect(run({ ...PRODUCTION, [key]: value }).failed.length).toBeGreaterThan(0);
  });

  it('an unset verifier fallback fails: its runtime default is a Testnet archival node', () => {
    const rest = { ...PRODUCTION, NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_URL: undefined };
    expect(run(rest).failed).toEqual(["NEXT_PUBLIC_TAPLY_VERIFIER_FALLBACK_RPC_URL is a mainnet host or 'off'"]);
  });

  it('an RPC host outside the verified mainnet list fails', () => {
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_RPC_URL: 'https://rpc.example-mainnet.io' }).failed).toEqual([
      'RPC set explicitly to an approved mainnet host',
    ]);
  });
});

describe('account binding', () => {
  it('Production refuses the staging contract', () => {
    const r = run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_CONTRACT_ID: MAINNET.stagingContract });
    expect(r.failed).toEqual(['NEXT_PUBLIC_TAPLY_CONTRACT_ID is the production contract']);
  });

  it('Preview may use the staging contract', () => {
    const r = run({
      ...PRODUCTION,
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_TAPLY_CONTRACT_ID: MAINNET.stagingContract,
      NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID: MAINNET.stagingContract,
      NEXT_PUBLIC_TAPLY_SHARE_ORIGIN: undefined,
    });
    expect(r.failed).toEqual([]);
  });

  it('the recovery account is never a contract, on any scope', () => {
    for (const scope of ['production', 'preview']) {
      const r = run({ ...PRODUCTION, VERCEL_ENV: scope, NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID: MAINNET.recoveryAccount });
      expect(r.failed).toContain('NEXT_PUBLIC_TAPLY_PROTECTED_CONTRACT_ID is never the recovery account');
    }
  });

  it('a contract id without its code hash fails', () => {
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH: '' }).failed).toEqual([
      'NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH set together with NEXT_PUBLIC_TAPLY_CONTRACT_ID',
    ]);
  });

  it('a signing flag without a pinned contract fails', () => {
    const r = run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY: 'on', NEXT_PUBLIC_TAPLY_CONTRACT_ID: '', NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH: '' });
    expect(r.failed).toEqual(['NEXT_PUBLIC_TAPLY_FLAG_INSTANT_PAY=on has a pinned contract']);
  });
});

describe('host and store isolation', () => {
  it.each(['https://taplyapp.xyz', 'https://www.taplyapp.xyz/'])('share origin %s (Testnet host) fails on any scope', (origin) => {
    expect(run({ ...PRODUCTION, VERCEL_ENV: 'preview', NEXT_PUBLIC_TAPLY_SHARE_ORIGIN: origin }).failed).toEqual([
      'share origin is not the Testnet host',
    ]);
  });

  it('Handshake on without its own store fails', () => {
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: 'on' }).failed).toEqual(['Handshake store configured for this project']);
    expect(
      run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_FLAG_HANDSHAKE: 'on', KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't' }).failed,
    ).toEqual([]);
  });

  it('a secret-looking public variable fails', () => {
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_ONECLICK_API_KEY: 'k' }).failed).toEqual(['no secret-looking NEXT_PUBLIC_ variable']);
  });

  it('server-only values are never printed', () => {
    const lines: string[] = [];
    const log = { log: (...a: unknown[]) => lines.push(a.join(' ')), error: (...a: unknown[]) => lines.push(a.join(' ')) };
    main(['--require-mainnet'], { ...PRODUCTION, TAPLY_ONECLICK_API_KEY: 'super-secret-value' }, WEB, log);
    expect(lines.join('\n')).not.toContain('super-secret-value');
    expect(lines.join('\n')).toContain('TAPLY_ONECLICK_API_KEY=(set, hidden)');
  });
});

describe('mainnet integration switches', () => {
  it('the authenticated authority test mode is refused on Production, allowed on a staging Preview', () => {
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY: 'isolated-http' }).failed).toEqual(['authenticated authority test mode off on Production']);
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY: 'off' }).failed).toEqual([]);
    expect(run({ ...PRODUCTION, VERCEL_ENV: 'preview', NEXT_PUBLIC_TAPLY_SHARE_ORIGIN: undefined, NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY: 'isolated-http' }).failed).toEqual([]);
  });

  it('the simulated wallet authority test harness is refused on Production', () => {
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION: 'on' }).failed).toEqual(['simulated wallet authority off on Production']);
    expect(run({ ...PRODUCTION, VERCEL_ENV: 'preview', NEXT_PUBLIC_TAPLY_SHARE_ORIGIN: undefined, NEXT_PUBLIC_TAPLY_MAINNET_AUTHORITY_SIMULATION: 'on' }).failed).toEqual([]);
  });

  it('unapproved Mainnet Gift and escrow contracts are refused on Production, allowed on a staging Preview', () => {
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID: 'gift-candidate.near' }).failed).toEqual(['Gift contract not configured on Production (not approved)']);
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID: 'escrow-candidate.near' }).failed).toEqual(['Mainnet escrow not configured on Production (not deployed/approved)']);
    const preview = { ...PRODUCTION, VERCEL_ENV: 'preview', NEXT_PUBLIC_TAPLY_SHARE_ORIGIN: undefined, NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID: 'gift-candidate.near', NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID: 'escrow-candidate.near' };
    expect(run(preview).failed).toEqual([]);
  });

  it('fixtures and fixture 1Click mode are refused on Production, allowed on a staging Preview', () => {
    expect(run({ ...PRODUCTION, NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES: 'on' }).failed).toEqual(['fixtures off on Production']);
    expect(run({ ...PRODUCTION, TAPLY_ONECLICK_MODE: 'fixture' }).failed).toEqual(['1Click fixture mode off on Production']);
    const preview = { ...PRODUCTION, VERCEL_ENV: 'preview', NEXT_PUBLIC_TAPLY_SHARE_ORIGIN: undefined, NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES: 'on', TAPLY_ONECLICK_MODE: 'fixture' };
    expect(run(preview).failed).toEqual([]);
  });

  it('funded 1Click quotes and the signing flag are refused on every scope', () => {
    for (const scope of ['production', 'preview']) {
      const base = { ...PRODUCTION, VERCEL_ENV: scope, NEXT_PUBLIC_TAPLY_SHARE_ORIGIN: scope === 'production' ? PRODUCTION['NEXT_PUBLIC_TAPLY_SHARE_ORIGIN'] : undefined };
      expect(run({ ...base, TAPLY_ONECLICK_MODE: 'funded' }).failed).toEqual(['TAPLY_ONECLICK_MODE is off, fixture or dry']);
      expect(run({ ...base, NEXT_PUBLIC_TAPLY_MAINNET_SIGNING: 'on' }).failed).toEqual(['signing only with the device ledger']);
      expect(run({ ...base, NEXT_PUBLIC_TAPLY_MAINNET_SIGNING: 'on', NEXT_PUBLIC_TAPLY_MAINNET_LEDGER: 'device' }).failed).toEqual([]);
    }
  });

  it('dry 1Click mode is allowed (non-funding)', () => {
    expect(run({ ...PRODUCTION, TAPLY_ONECLICK_MODE: 'dry' }).failed).toEqual([]);
  });
});

describe('env file resolution follows Next.js precedence', () => {
  it('process env beats .env.local beats .env.production beats .env', () => {
    const { env, source } = resolveBuildEnv(
      { A: 'process' },
      { '.env': 'A=base\nB=base\nC=base\nD=base', '.env.production': 'B=prod\nC=prod\nA=prod', '.env.local': 'C=local' },
    );
    expect(env).toMatchObject({ A: 'process', B: 'prod', C: 'local', D: 'base' });
    expect(source['B']).toBe('.env.production');
  });

  it('quotes, comments and variable expansion', () => {
    const { values, problems } = parseEnvFile('# c\nA="x y"\nB=z # trailing\nC=\'$lit\'\nD=$OTHER\n');
    expect(values).toMatchObject({ A: 'x y', B: 'z', C: '$lit' });
    expect(problems).toEqual(['D: variable expansion is not supported']);
  });
});
