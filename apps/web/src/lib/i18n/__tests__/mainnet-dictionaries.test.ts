import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTIONARIES } from '../index';
import { buildMainnetDictionaries } from '../mainnet-dictionary-rules';
import { LOCALE_NAMES } from '../locale-names';

const FILE = resolve(__dirname, '../mainnet-dictionaries.generated.json');
// Same list the Mainnet browser leak scan uses (scripts/mainnet-1click-qa.mjs).
const LEAKS = ['taply-e2e-ce38a238', 'taply-pay-pilot-1.testnet', 'rpc.testnet.near.org', 'test.rpc.fastnear.com', 'archival-rpc.testnet',
  'testnet.nearblocks.io', 'FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b', '963iSEB8XFKeUMY1gmj5bCuA2JMVD55ksjdLfCwiPA84',
  'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B', 'taply.testnet-vault.v1', '"abandon","ability"', 'faucet'];

describe('NEAR Mainnet dictionaries (generated)', () => {
  const expected = `${JSON.stringify(buildMainnetDictionaries(DICTIONARIES), null, 1)}\n`;
  if (process.env['TAPLY_WRITE_MAINNET_DICT'] === '1') writeFileSync(FILE, expected);

  it('matches the Testnet dictionaries + Mainnet rules', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(expected);
  });

  it('carries no Testnet endpoint, contract, vault key or faucet wording', () => {
    const text = readFileSync(FILE, 'utf8');
    for (const leak of LEAKS) expect(text.includes(leak), leak).toBe(false);
    // Keys keep their Testnet-era names; no rendered value says Testnet.
    const values: string[] = [];
    const walk = (v: unknown): void => { if (typeof v === 'string') values.push(v); else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(JSON.parse(text));
    expect(values.filter((v) => /testnet/i.test(v))).toEqual([]);
  });

  it('says NEAR Mainnet where Testnet said NEAR Testnet', () => {
    const d = buildMainnetDictionaries(DICTIONARIES);
    expect(d.en.app.networkBadge).toBe('NEAR Mainnet');
    expect(d.en.app.demoFundsNote).toBe('Real funds.');
  });

  it('locale names match each dictionary (the language switch reads LOCALE_NAMES)', () => {
    expect(LOCALE_NAMES.en).toBe(DICTIONARIES.en.localeName);
    expect(LOCALE_NAMES.tr).toBe(DICTIONARIES.tr.localeName);
  });
});
