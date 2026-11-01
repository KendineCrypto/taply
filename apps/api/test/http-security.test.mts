import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableStore, SqliteSessionPersistence } from '../src/storage.mts';
import { DurableAuth, emptyAuth } from '../src/durable-auth.mts';
import { SessionEngine } from '../src/sessions.mts';
import { createNep413Verifier } from '../src/nep413.mts';
import { createCommerceHandler } from '../src/commerce-http.mts';
import { testSigner } from './signer-fixture.mts';
import { calculateRequestId, calculateTermsHash, calculateSessionCommitment, ApiErrorSchema } from '../../../packages/shared/dist/index.js';

test('every mutation enforces cookie/CSRF/origin; roles, cross-session reads and status forgery cannot escalate',async()=>{
  const origin='https://taply.example',contractId='payments.fixture.testnet',now=Date.now();
  const dir=mkdtempSync(join(tmpdir(),'taply-http-review-')),path=join(dir,'test.db'),key=randomBytes(32);
  const db=new DurableStore(path,key,'auth',emptyAuth,true),sessions=new SqliteSessionPersistence(path,key,true);
  const verifier=createNep413Verifier(origin,contractId,async(accountId,publicKey)=>({accountId,publicKey,blockHash:'1'.repeat(32),blockHeight:'1'}));
  const auth=new DurableAuth(db,origin,contractId,verifier);let record: any;
  const engine=new SessionEngine(sessions,{contractId,now:()=>now,authenticate:async token=>auth.session(String(token)).identity,readCanonicalRequest:async()=>record});
  const handle=createCommerceHandler({origin,auth,engine,authenticationAccepted:true});
  type Login={token:string;csrf:string};
  const login=async(account:string)=>{const c=auth.challenge(account);return auth.verify(c.challenge.id,c.browserToken,testSigner()(c.challenge));};
  let requestNumber=0;
  const request=async(method:string,path:string,input:unknown,user?:Login,headers:Record<string,string>={})=>{
    const r=await handle(new Request(origin+'/api/v1/'+path,{method,headers:{origin,'content-type':'application/json',
      ...(user?{cookie:`__Host-taply-session=${user.token}`,'x-csrf-token':user.csrf}:{}),
      'idempotency-key':`review_test_${String(++requestNumber).padStart(8,'0')}`,...headers},
      ...(method==='POST'?{body:JSON.stringify(input)}:{})}),`case-${requestNumber}`);
    assert.equal(r.headers.get('access-control-allow-origin'),null);
    assert.equal(r.headers.get('cache-control'),'no-store');
    const data=await r.json();if(r.status>=400) ApiErrorSchema.parse(data);
    return {status:r.status,data};
  };
  try {
    const merchant=await login('alice.testnet'),payer=await login('bob.testnet'),outsider=await login('eve.testnet');
    for(const route of ['auth/challenges','auth/verify']) {
      assert.equal((await request('POST',route,{},undefined,{origin:''})).status,403);
      assert.equal((await request('POST',route,{},undefined,{origin:'https://evil.example'})).status,403);
    }
    const challenge=auth.challenge('http-login.testnet'),signed=testSigner()(challenge.challenge);
    const verification={challengeId:challenge.challenge.id,signed};
    assert.equal((await request('POST','auth/verify',verification)).status,403);
    assert.equal((await request('POST','auth/verify',verification,undefined,{cookie:'__Host-taply-browser=wrong'})).status,403);
    assert.equal((await request('POST','auth/verify',{...verification,signed:{...signed,accountId:'evil.testnet'}},undefined,
      {cookie:`__Host-taply-browser=${challenge.browserToken}`})).status,401);
    assert.equal((await request('POST','auth/verify',verification,undefined,
      {cookie:`__Host-taply-browser=${challenge.browserToken}`})).data.error.code,'AUTH_CHALLENGE_USED');
    const created=await engine.create(merchant.token,'security_create_key'),s=created.session;
    const other=await engine.create(merchant.token,'security_other_key');
    const terms=JSON.parse(readFileSync(new URL('../../../packages/shared/test-vectors/intent-a.json',import.meta.url),'utf8'));
    Object.assign(terms,{mode:'instant',cancelDurationNs:null,fundingExpiresAtNs:String(BigInt(now+180000)*1000000n),sessionBinding:{id:s.id,nonce:s.nonce,expiresAtNs:s.expiresAtNs}});
    const {creationNonce,creatorAccountId,network}=terms;terms.id=calculateRequestId({contractId,creationNonce,creatorAccountId,network});
    record={terms,termsHash:calculateTermsHash(terms),sessionCommitment:calculateSessionCommitment(terms),recipientAccountId:'alice.testnet',status:'OPEN',revision:'1',createdAtNs:String(BigInt(now)*1000000n),payerAccountId:null,fundedAtNs:null,cancelUntilNs:null,settlementBranch:null,latestOperation:null};
    const routes:[string,unknown][]=[['sessions',{}],[`sessions/${s.id}/bind`,{intentId:terms.id,termsHash:record.termsHash}],
      [`sessions/${s.id}/join`,{joinToken:created.joinToken}],[`sessions/${s.id}/review`,{termsHash:record.termsHash}],
      [`sessions/${s.id}/presence`,{connected:true}],[`sessions/${s.id}/close`,{}],['auth/logout',{}],
      [`sessions/${s.id}/room/presence`,{connectionId:'11111111-1111-4111-8111-111111111111',sequence:'1',state:'active'}],
      [`sessions/${s.id}/room/progress`,{expectedCursor:'0',phase:'AWAITING_WALLET',transactionHash:null,termsHash:record.termsHash}]];
    const disabled=createCommerceHandler({origin,auth,engine,authenticationAccepted:false});
    for(const [route,input] of routes) {
      const result=await disabled(new Request(origin+'/api/v1/'+route,{method:'POST',headers:{origin,'content-type':'application/json',
        cookie:`__Host-taply-session=${merchant.token}`,'x-csrf-token':merchant.csrf},body:JSON.stringify(input)}),'disabled-client');
      assert.equal(result.status,503);assert.equal(result.headers.get('set-cookie'),null);
    }
    for(const [route,input] of routes) {
      assert.equal((await request('POST',route,input)).status,401,route);
      assert.equal((await request('POST',route,input,merchant,{'x-csrf-token':'wrong'})).status,403,route);
      assert.equal((await request('POST',route,input,merchant,{origin:'https://evil.example'})).status,403,route);
      assert.equal((await request('POST',route,{...(input as object),paid:true,role:'merchant'},merchant)).status,400,route);
    }
    for(const route of [`sessions/${s.id}/bind`,`sessions/${s.id}/close`])
      assert.equal((await request('POST',route,route.endsWith('bind')?{intentId:terms.id,termsHash:record.termsHash}:{},outsider)).status,403);
    assert.equal((await request('POST',`sessions/${s.id}/bind`,{intentId:terms.id,termsHash:record.termsHash},merchant)).status,200);
    assert.equal((await request('POST',`sessions/${s.id}/join`,{joinToken:created.joinToken},payer)).status,200);
    for(const route of [`sessions/${s.id}`,`sessions/${s.id}/events`,`sessions/${s.id}/room`,`sessions/${other.session.id}`])
      assert.equal((await request('GET',route,{},route.endsWith(other.session.id)?payer:outsider)).status,403);
    for(const [action,input] of [['review',{termsHash:record.termsHash}],['presence',{connected:true}],['close',{}]] as const)
      assert.equal((await request('POST',`sessions/${s.id}/${action}`,input,outsider)).status,403);
    assert.equal((await request('POST',`sessions/${s.id}/review`,{termsHash:'0'.repeat(64)},payer)).data.error.code,'TERMS_MISMATCH');
    assert.equal((await request('POST',`sessions/${s.id}/join`,{joinToken:created.joinToken},outsider)).data.error.code,'JOIN_TOKEN_USED');
    assert.equal((await request('GET','auth/me',{},merchant,{cookie:`__Host-taply-session=${merchant.token}; __Host-taply-session=forged`})).status,400);
    assert.equal((await request('OPTIONS','sessions',{},merchant)).status,400);
    const error=await request('POST',`sessions/${s.id}/review`,{termsHash:'secret-marker',paid:true},payer);
    assert.ok(!JSON.stringify(error.data).includes('secret-marker'));assert.deepEqual(error.data.error.details,{});
    assert.equal((await request('POST','auth/logout',{},payer)).status,200);
    for(const [route,input] of routes) assert.equal((await request('POST',route,input,payer)).status,401,route);
  } finally {db.close();sessions.close();rmSync(dir,{recursive:true,force:true});}
});
