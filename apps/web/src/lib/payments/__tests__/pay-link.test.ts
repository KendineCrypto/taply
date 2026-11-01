import { describe, expect, it } from 'vitest';
import { MAX_PAY_INPUT_LENGTH, parsePayInput } from '../pay-link';

const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const APPROVED = ['https://pay.taply.app', 'http://localhost:3000'];

describe('parsePayInput (pasted links and decoded QR payloads are untrusted)', () => {
  it('accepts a pay link from an approved origin, keeping only the request ID', () => {
    expect(parsePayInput(`https://pay.taply.app/pay/${ID}`, APPROVED)).toEqual({ kind: 'request', id: ID });
    expect(parsePayInput(`  http://localhost:3000/pay/${ID}/  `, APPROVED)).toEqual({ kind: 'request', id: ID });
    // A trailing newline (common in QR payloads) is fine.
    expect(parsePayInput(`https://pay.taply.app/pay/${ID}\n`, APPROVED)).toEqual({ kind: 'request', id: ID });
  });

  it('accepts a bare request ID', () => {
    expect(parsePayInput(ID, APPROVED)).toEqual({ kind: 'request', id: ID });
    expect(parsePayInput(ID, [])).toEqual({ kind: 'request', id: ID });
  });

  it('drops the query and fragment: no amount, recipient or wallet-return parameter survives', () => {
    const parsed = parsePayInput(
      `https://pay.taply.app/pay/${ID}?amount=999&recipient=evil.testnet&transactionHashes=abc#x`,
      APPROVED,
    );
    expect(parsed).toEqual({ kind: 'request', id: ID });
  });

  it('reports a pay link from another site with its host, and does not open it', () => {
    expect(parsePayInput(`https://taply-pay.evil.example/pay/${ID}`, APPROVED)).toEqual({
      kind: 'other_site',
      host: 'taply-pay.evil.example',
    });
    // Same host, different scheme or port: a different origin.
    expect(parsePayInput(`http://pay.taply.app/pay/${ID}`, APPROVED).kind).toBe('other_site');
    expect(parsePayInput(`https://pay.taply.app:8443/pay/${ID}`, APPROVED).kind).toBe('other_site');
    // Lookalike suffix tricks are just other hosts.
    expect(parsePayInput(`https://pay.taply.app.evil.example/pay/${ID}`, APPROVED).kind).toBe('other_site');
  });

  it('rejects anything that is not exactly a request link', () => {
    for (const text of [
      '',
      '   ',
      'hello',
      'WIFI:S:home;T:WPA;P:secret;;',
      `https://pay.taply.app/receipt/${ID}`,
      `https://pay.taply.app/pay/${ID}/extra`,
      `https://pay.taply.app/pay/${ID.slice(1)}`,
      `https://pay.taply.app/pay/${ID.toUpperCase()}`,
      `https://pay.taply.app/pay/${ID}%2F..`,
      `javascript:alert(1)//pay/${ID}`,
      `data:text/html,<a href="/pay/${ID}">`,
      `ftp://pay.taply.app/pay/${ID}`,
      `near:pay.taply.app/pay/${ID}`,
      `https://user:pw@pay.taply.app/pay/${ID}`,
      `https://pay.taply.app/pay/${ID}‮`,
      `${ID}​`,
      `https://pay.taply.app/pay/${ID}?${'x'.repeat(MAX_PAY_INPUT_LENGTH)}`,
    ]) {
      expect(parsePayInput(text, APPROVED), text.slice(0, 80)).toEqual({ kind: 'invalid' });
    }
  });
});
