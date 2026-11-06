import { describe, expect, it } from 'vitest';
import { parseScanInput } from '../pay-link';

/**
 * Phase 7D adversarial table for everything the scanner or paste field accepts.
 * The only possible outcomes that lead anywhere are:
 *   - { kind: 'request', id }      -> this app's own /pay/<id> (terms read from chain, wallet only after review)
 *   - { kind: 'merchant', accountId } -> this app's own read-only /checkout/<accountId>
 * Nothing here can carry an amount, a recipient, a redirect target or a wallet action.
 */

const ORIGIN = 'https://pay.taply.app';
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const parse = (s: string) => parseScanInput(s, [ORIGIN]);

describe('QR security: accepted inputs keep only the identifier', () => {
  it.each([
    [`${ORIGIN}/pay/${ID}`, { kind: 'request', id: ID }],
    [`${ORIGIN}/pay/${ID}?amount=1000&recipient=evil.testnet&transactionHashes=x#errorCode=userRejected`, { kind: 'request', id: ID }],
    [`${ORIGIN}/checkout/shop.testnet`, { kind: 'merchant', accountId: 'shop.testnet' }],
    [`${ORIGIN}/checkout/shop.testnet?amount=999&to=evil.testnet&next=https://evil.app`, { kind: 'merchant', accountId: 'shop.testnet' }],
    // Equivalent spellings of the same approved origin.
    [`HTTPS://PAY.TAPLY.APP/checkout/shop.testnet`, { kind: 'merchant', accountId: 'shop.testnet' }],
    [`https://pay.taply.app:443/checkout/shop.testnet`, { kind: 'merchant', accountId: 'shop.testnet' }],
    [`${ORIGIN}/x/../checkout/shop.testnet`, { kind: 'merchant', accountId: 'shop.testnet' }],
    // Encoded dot segments normalize to this app's own pay path: identical to scanning
    // that request's QR (chain-read review, wallet approval required). Not a merchant.
    [`${ORIGIN}/checkout/%2e%2e/pay/${ID}`, { kind: 'request', id: ID }],
  ])('%s', (input, expected) => {
    expect(parse(input)).toEqual(expected);
  });
});

describe('QR security: other hosts are named, never followed', () => {
  it.each([
    ['https://pay.taply.app.evil.app/checkout/shop.testnet', 'pay.taply.app.evil.app'],
    ['https://pаy.taply.app/checkout/shop.testnet', 'xn--py-7kc.taply.app'], // Cyrillic "а" homograph
    ['https://pay.taply.app./checkout/shop.testnet', 'pay.taply.app.'], // trailing-dot FQDN is a different origin string
    ['http://pay.taply.app/checkout/shop.testnet', 'pay.taply.app'], // downgrade to http
    ['https://pay.taply.app:8443/checkout/shop.testnet', 'pay.taply.app:8443'],
    [`https://evil.app/pay/${ID}`, 'evil.app'],
  ])('%s', (input, host) => {
    expect(parse(input)).toEqual({ kind: 'other_site', host });
  });
});

describe('QR security: everything else is rejected', () => {
  it.each([
    // Not an account / not Testnet / manipulated account segment.
    `${ORIGIN}/checkout/shop.near`,
    `${ORIGIN}/checkout/SHOP.testnet`,
    `${ORIGIN}/checkout/%73hop.testnet`,
    `${ORIGIN}/checkout/shop.testnet%2Fpay%2F${ID}`,
    `${ORIGIN}/checkout/shop%00.testnet`,
    `${ORIGIN}/checkout/${'a'.repeat(65)}.testnet`,
    `${ORIGIN}/checkout/-shop.testnet`,
    // Wrong or extra path segments, empty segments.
    `${ORIGIN}//checkout/shop.testnet`,
    `${ORIGIN}/checkout/shop.testnet/pay/${ID}`,
    `${ORIGIN}/checkout`,
    `${ORIGIN}/checkout/`,
    `${ORIGIN}/merchant/register?amount=5`,
    `${ORIGIN}/redirect?to=/checkout/shop.testnet`,
    `${ORIGIN}/pay/${ID.toUpperCase()}`,
    `${ORIGIN}/pay/%39${ID.slice(1)}`,
    // Origin smuggled into the path of another host.
    'https://evil.app/pay.taply.app/checkout/shop.testnet',
    // Credentials, schemes, app links, data and script.
    `https://pay.taply.app@evil.app/checkout/shop.testnet`,
    `https://user:pw@pay.taply.app/checkout/shop.testnet`,
    'javascript:location="https://evil.app"//checkout/shop.testnet',
    'data:text/html;base64,PHNjcmlwdD4=',
    'intent://pay.taply.app/checkout/shop.testnet#Intent;scheme=https;end',
    'taply://checkout/shop.testnet',
    'near:shop.testnet?amount=1',
    'ftp://pay.taply.app/checkout/shop.testnet',
    // Malformed payloads.
    '',
    '   ',
    'shop.testnet',
    '{"recipient":"shop.testnet","amount":"1"}',
    `${ORIGIN}/checkout/shop.testnet‮`,
    `​${ORIGIN}/checkout/shop.testnet`,
    `${ORIGIN}/checkout/shop.testnet\n${ORIGIN}/pay/${ID}`,
    'x'.repeat(5000),
  ])('%s', (input) => {
    const parsed = parse(input);
    expect(['invalid', 'invalid_merchant']).toContain(parsed.kind);
  });
});
