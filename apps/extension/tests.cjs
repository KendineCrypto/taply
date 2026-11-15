'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./shared.js');
const ID = 'a'.repeat(64);

test('normal profile handle recognized', () => {
  assert.equal(h.profileHandle('/kendinecrypto_'), 'kendinecrypto_');
  assert.equal(h.profileHandle('/taplyHQ/'), 'taplyHQ');
});
test('non-profile X routes are never tipped', () => {
  for (const path of ['/home','/messages','/i/chat/123','/explore','/taplyHQ/status/123','/settings']) {
    assert.equal(h.profileHandle(path), null, path);
  }
});
test('only allowed NEAR Testnet accounts', () => {
  for (const a of ['alice.testnet','taply-shop-8406e9.testnet','a'.repeat(64)]) {
    assert.equal(h.validTestnetAccount(a), true, a);
  }
  for (const a of ['', 'alice.near', 'alice.testnet.evil.org', 'evil\n.testnet', 'bad..testnet', '0x123']) {
    assert.equal(h.validTestnetAccount(a), false, a);
  }
});
test('exact positive amount and decimal precision', () => {
  for (const value of ['0.1','1','999999','0.000000000000000000000001','12.345']) {
    assert.equal(h.validNearAmount(value), true, value);
  }
  for (const value of ['','0','-1','1e2','Infinity','1,5','1000000','01','0.' + '1'.repeat(25)]) {
    assert.equal(h.validNearAmount(value), false, value);
  }
});
test('tips are only explicit links to the fixed Taply origin', () => {
  const url = h.tipUrl('Alice.testnet', '0.5');
  assert.equal(new URL(url).origin, 'https://taplyapp.xyz');
  assert.equal(new URL(url).searchParams.get('to'), 'alice.testnet');
  assert.equal(new URL(url).searchParams.get('amount'), '0.5');
  assert.equal(h.tipUrl('alice.near','1'), null);
});
test('recognizes exact canonical request and proof links', () => {
  assert.deepEqual(h.parseTaplyLink('https://taplyapp.xyz/pay/' + ID), {
    kind:'pay',id:ID,url:'https://taplyapp.xyz/pay/' + ID
  });
  assert.equal(h.parseTaplyLink('https://taplyapp.xyz/receipt/' + ID + '?ftx=anything').kind, 'receipt');
  assert.equal(h.parseTaplyLink('https://taplyapp.xyz/protected/' + ID).kind, 'protected');
});
test('no lookalike domains, credentials or wrong scheme', () => {
  for (const url of [
    'http://taplyapp.xyz/pay/' + ID,
    'https://taplyapp.xyz.evil.com/pay/' + ID,
    'https://taplyapp.xyz@evil.com/pay/' + ID,
    'https://evil.com/pay/' + ID,
    'https://taplyapp.xyz/pay/123',
    'https://taplyapp.xyz/checkout/alice.testnet',
  ]) assert.equal(h.parseTaplyLink(url), null, url);
});
