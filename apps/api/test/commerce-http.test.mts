import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableStore, SqliteSessionPersistence } from '../src/storage.mts';
import { DurableAuth, emptyAuth } from '../src/durable-auth.mts';
import { createNep413Verifier } from '../src/nep413.mts';
import { SessionEngine } from '../src/sessions.mts';
import { createCommerceHandler } from '../src/commerce-http.mts';
import { createCommerceService } from '../src/service.mts';
import { testSigner } from './signer-fixture.mts';
import { calculateRequestId, calculateTermsHash, calculateSessionCommitment, comparisonCode } from '../../../packages/shared/dist/index.js';

test('two authenticated clients complete durable offline Handshake via HTTP handlers, never Verified Paid', async () => {
  const dir=mkdtempSync(join(tmpdir(),'taply-http-')), path=join(dir,'test.db'), key=randomBytes(32);
  const origin='https://taply.example', contractId='payments.fixture.testnet'; const now=Date.now();
  const store=new DurableStore(path,key,'auth',emptyAuth,true), sessions=new SqliteSessionPersistence(path,key,true);
  // Real crypto, synthetic finalized association only. No RPC/transaction/wallet.
  const verifier=createNep413Verifier(origin,contractId,async(accountId,publicKey)=>({accountId,publicKey,blockHash:'1'.repeat(32),blockHeight:'1'}),()=>now);
  const auth=new DurableAuth(store,origin,contractId,verifier,()=>now); let record: any;
  const engine=new SessionEngine(sessions,{contractId,now:()=>now,
    authenticate:async token=>auth.session(String(token)).identity,readCanonicalRequest:async()=>structuredClone(record)});
  const handle=createCommerceHandler({origin,auth,engine,authenticationAccepted:true});
  function client(ip: string) {
    const jar=new Map<string,string>(); let csrf='';
    const call=async(method: string,path: string,data?: unknown,extra: Record<string,string>={})=>{
      const response=await handle(new Request(origin+'/api/v1/'+path,{method,headers:{origin,'content-type':'application/json',
        cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'x-csrf-token':csrf,'idempotency-key':'integration_key_0001',...extra},
        ...(method==='POST'?{body:JSON.stringify(data??{})}:{})}),ip);
      for(const value of response.headers.getSetCookie()) {
        assert.match(value,/Secure; HttpOnly; SameSite=Strict/); const [pair]=value.split(';'); const [name,token]=pair.split('='); jar.set(name,token);
      }
      assert.equal(response.headers.get('cache-control'),'no-store'); assert.equal(response.headers.get('access-control-allow-origin'),null);
      return {status:response.status,headers:response.headers,data:response.headers.get('content-type')?.startsWith('text/event-stream') ? await response.text() : await response.json()};
    };
    return { call, async login(accountId: string) {
      const challenge=await call('POST','auth/challenges',{accountId}); assert.equal(challenge.status,200);
      const result=await call('POST','auth/verify',{challengeId:challenge.data.id,signed:testSigner()(challenge.data)});
      assert.equal(result.status,200); csrf=result.data.csrfToken;
    } };
  }
  try {
    for(const raw of ['{"accountId":"alice.testnet","accountId":"evil.testnet"}', '{{',
      JSON.stringify({accountId:'x'.repeat(9000)}), JSON.stringify({accountId:'alice.testnet',paid:true})]) {
      const response=await handle(new Request(origin+'/api/v1/auth/challenges',{method:'POST',
        headers:{origin,'content-type':'application/json'},body:raw}),'malformed-client');
      assert.equal(response.status,400); assert.equal(response.headers.get('set-cookie'),null);
    }
    const merchant=client('merchant-client'),payer=client('payer-client');
    await merchant.login('alice.testnet'); await payer.login('bob.testnet');
    const created=await merchant.call('POST','sessions',{}); assert.equal(created.status,200); const s=created.data.session;
    // Canonical fixture A adapted for this generated session and Instant mode.
    const terms=JSON.parse(readFileSync(new URL('../../../packages/shared/test-vectors/intent-a.json',import.meta.url),'utf8'));
    Object.assign(terms,{mode:'instant',cancelDurationNs:null,fundingExpiresAtNs:String(BigInt(now+180000)*1000000n),
      sessionBinding:{id:s.id,nonce:s.nonce,expiresAtNs:s.expiresAtNs}});
    terms.id=calculateRequestId({contractId,creationNonce:terms.creationNonce,creatorAccountId:terms.creatorAccountId,network:terms.network});
    record={terms,termsHash:calculateTermsHash(terms),sessionCommitment:calculateSessionCommitment(terms),recipientAccountId:'alice.testnet',
      status:'OPEN',revision:'1',createdAtNs:String(BigInt(now)*1000000n),payerAccountId:null,fundedAtNs:null,cancelUntilNs:null,settlementBranch:null,latestOperation:null};
    assert.equal((await merchant.call('POST',`sessions/${s.id}/bind`,{intentId:terms.id,termsHash:record.termsHash})).status,200);
    assert.equal((await payer.call('POST',`sessions/${s.id}/join`,{joinToken:created.data.joinToken})).status,200);
    const m=await merchant.call('GET',`sessions/${s.id}`),p=await payer.call('GET',`sessions/${s.id}`);
    assert.equal(m.data.comparisonCode,p.data.comparisonCode); assert.equal(p.data.comparisonCode,comparisonCode(calculateSessionCommitment(terms)!));
    assert.equal((await merchant.call('POST',`sessions/${s.id}/review`,{termsHash:record.termsHash})).data.state,'PAIRED');
    assert.equal((await payer.call('POST',`sessions/${s.id}/review`,{termsHash:record.termsHash})).data.state,'REVIEWED');
    const roomPath = `sessions/${s.id}/room`;
    const room = await payer.call('GET', roomPath);
    assert.equal(room.status, 200); assert.equal(room.data.room.phase, 'WAITING_FOR_WALLET');
    assert.equal(room.data.room.authority, 'coordination_only');
    assert.equal(room.data.events.at(-1).room.session.state, 'REVIEWED');
    const progress = { expectedCursor: room.data.cursor, phase: 'AWAITING_WALLET', transactionHash: null, termsHash: record.termsHash };
    assert.equal((await merchant.call('POST', `${roomPath}/progress`, progress)).status, 403);
    assert.equal((await payer.call('POST', `${roomPath}/progress`, { ...progress, paid: true })).status, 400);
    const opened = await payer.call('POST', `${roomPath}/progress`, progress);
    assert.equal(opened.status, 200);
    const caughtUp = await merchant.call('GET', roomPath, undefined, { 'last-event-id': room.data.cursor });
    assert.equal(caughtUp.data.events.length, 1);
    assert.equal(caughtUp.data.events[0].type, 'payer.progress');
    const connectionId = '11111111-1111-4111-8111-111111111111';
    assert.equal((await payer.call('POST', `${roomPath}/presence`, { connectionId, sequence: '1', state: 'active' })).status, 200);
    assert.equal((await payer.call('POST', `${roomPath}/presence`, { connectionId, sequence: '1', state: 'active', accountId: 'mallory.testnet' })).status, 400);
    assert.equal((await merchant.call('GET', roomPath, undefined, { 'last-event-id': '01' })).status, 400);
    const sse = await payer.call('GET', roomPath, undefined, { accept: 'text/event-stream', 'last-event-id': room.data.cursor });
    assert.equal(sse.status, 200); assert.match(sse.headers.get('content-type')!, /^text\/event-stream/);
    assert.match(sse.data, /event: room.changed/); assert.match(sse.data, /event: room.snapshot/);
    assert.ok(!sse.data.includes(created.data.joinToken));
    assert.equal((await payer.call('POST', `${roomPath}/presence`, { connectionId, sequence: '2', state: 'disconnected' })).status, 200);
    for(const connected of [true,false,true]) assert.equal((await payer.call('POST',`sessions/${s.id}/presence`,{connected})).data.presence.payer,connected);
    const hints=await payer.call('GET',`sessions/${s.id}/events`); assert.equal(hints.status,200);
    assert.ok(!JSON.stringify(hints.data).includes('FINAL_PAID')); assert.ok(!JSON.stringify(hints.data).includes('verified_final'));
    assert.equal((await payer.call('POST',`sessions/${s.id}/review`,{termsHash:record.termsHash,paid:true})).status,400);
    assert.equal((await merchant.call('POST',`sessions/${s.id}/close`,{})).data.state,'CLOSED');
    assert.equal((await payer.call('POST','sessions',{}, {'x-csrf-token':'wrong'})).status,403);
    assert.equal((await payer.call('POST','sessions',{}, {origin:'https://evil.example'})).status,403);
    assert.equal((await payer.call('GET','auth/me?token=secret')).status,400);
    assert.equal((await payer.call('POST','auth/logout',{})).status,200);
    assert.equal((await payer.call('GET','auth/me')).status,401);
    const revokedRoom = await payer.call('GET', roomPath, undefined, { accept: 'text/event-stream' });
    assert.equal(revokedRoom.status, 401); assert.match(revokedRoom.headers.get('content-type')!, /application\/json/);
    // Invalidate outstanding auth session and confirm bind re-authentication after RPC.
    assert.equal((await merchant.call('GET','merchants/alice.testnet')).status,404);
  } finally {store.close();sessions.close();rmSync(dir,{recursive:true,force:true});}
});
test('production composition refuses login and rate abuse fails closed', async () => {
  const dir=mkdtempSync(join(tmpdir(),'taply-gates-')),path=join(dir,'test.db');
  const service=createCommerceService(path,randomBytes(32),'https://taply.example',true);
  try {
    const response=await service.handle(new Request('https://taply.example/api/v1/auth/challenges',{method:'POST',headers:{origin:'https://taply.example'}}),'client');
    assert.equal(response.status,503); assert.equal(response.headers.get('set-cookie'),null);
    for (const suffix of ['', '/presence', '/progress']) {
      const gated = await service.handle(new Request(`https://taply.example/api/v1/sessions/11111111-1111-4111-8111-111111111111/room${suffix}`, {
        method: suffix ? 'POST' : 'GET', headers: { origin: 'https://taply.example', accept: 'text/event-stream' },
      }), 'room-client');
      assert.equal(gated.status, 503); assert.match(gated.headers.get('content-type')!, /application\/json/);
    }
    let last: Response|undefined;
    for(let i=0;i<61;i++) last=await service.handle(new Request('https://taply.example/api/v1/auth/me'),'abusive-client');
    assert.equal(last!.status,429);
  } finally {service.close();rmSync(dir,{recursive:true,force:true});}
});
