import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateMainnetRequestId} from '@taply/shared';
import {bindMainnetCommerceTerms,verifyMainnetCommerceBinding} from '../dist/index.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/mainnet-protocol/protected-open.json',import.meta.url),'utf8')).terms;
for(const kind of ['instant','escrow'])test(`immutable ${kind} commerce commitment binds exact terms and prevents session reissuance`,()=>{
  const draft=kind==='escrow'?fixture:{...fixture,contractId:'devkendinecrypto.near',mode:'instant',cancelDurationNs:null};
  if(kind==='instant')draft.id=calculateMainnetRequestId({network:draft.network,contractId:draft.contractId,creatorAccountId:draft.creatorAccountId,creationNonce:draft.creationNonce});
  const session={version:'taply.commerce.v1',network:'near-mainnet',contractId:draft.contractId,merchantAccountId:draft.creatorAccountId,sessionId:'a'.repeat(64),sessionNonce:'b'.repeat(64),expiresAtNs:draft.fundingExpiresAtNs};
  const b=bindMainnetCommerceTerms(kind,draft,session);
  assert.equal(verifyMainnetCommerceBinding(kind,b.terms,session,b.termsHash),true);
  for(const patch of [{amountBaseUnits:'2'},{memo:b.terms.memo+'tampered'},{creatorAccountId:'other.near'},{permittedPayerAccountId:'other.near'}])
    assert.equal(verifyMainnetCommerceBinding(kind,{...b.terms,...patch},session,b.termsHash),false);
  for(const patch of [{sessionNonce:'c'.repeat(64)},{sessionId:'c'.repeat(64)},{merchantAccountId:'other.near'},{network:'near-testnet'},{expiresAtNs:'1'}])
    assert.equal(verifyMainnetCommerceBinding(kind,b.terms,{...session,...patch},b.termsHash),false);
  const changed=bindMainnetCommerceTerms(kind,{...draft,amountBaseUnits:'2'},session);
  assert.equal(changed.terms.id,b.terms.id);assert.notEqual(changed.termsHash,b.termsHash);
  const later=bindMainnetCommerceTerms(kind,draft,{...session,expiresAtNs:(BigInt(session.expiresAtNs)+1n).toString()});
  assert.equal(later.terms.id,b.terms.id);assert.notEqual(later.termsHash,b.termsHash);
  assert.throws(()=>bindMainnetCommerceTerms(kind,b.terms,session),/ALREADY_BOUND/);
  assert.throws(()=>bindMainnetCommerceTerms(kind,{...draft,memo:'x'.repeat(250)},session));
});
