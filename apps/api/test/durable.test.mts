import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableStore, SqliteSessionPersistence } from '../src/storage.mts';
import { DurableAuth, emptyAuth } from '../src/durable-auth.mts';
import { createNep413Verifier } from '../src/nep413.mts';
import { testSigner } from './signer-fixture.mts';
import { SessionEngine } from '../src/sessions.mts';

test('SQLite survives restart, serializes separate connections, rolls back exceptions and refuses wrong key/missing DB', () => {
  const dir=mkdtempSync(join(tmpdir(),'taply-storage-')), path=join(dir,'test.db'), key=randomBytes(32);
  try {
    const a=new DurableStore(path,key,'test',()=>({counter:0,secret:'private-test-marker'}),true);
    const b=new DurableStore(path,key,'test',()=>({counter:0,secret:''}));
    for (let i=0;i<20;i++) (i%2?a:b).transaction(s=>{s.counter++;});
    assert.throws(()=>a.transaction(s=>{s.counter++;throw Error('abort');}));
    a.close(); b.close();
    const restarted=new DurableStore(path,key,'test',()=>({counter:0}));
    assert.equal(restarted.transaction(s=>s.counter),20); restarted.close();
    assert.equal(readFileSync(path).includes(Buffer.from('private-test-marker')),false);
    assert.throws(()=>new DurableStore(path,randomBytes(32),'test',()=>({})));
    assert.throws(()=>new DurableStore(join(dir,'missing.db'),key,'test',()=>({})),/VERIFICATION_UNAVAILABLE/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('durable challenge replay and auth sessions survive restart; logout and expiry remain enforced', async () => {
  const dir=mkdtempSync(join(tmpdir(),'taply-auth-')), path=join(dir,'test.db'), key=randomBytes(32); let now=Date.now();
  const verifier=createNep413Verifier('https://taply.example','pilot.testnet',async(accountId,publicKey)=>({accountId,publicKey,blockHash:'1'.repeat(32),blockHeight:'1'}),()=>now);
  let store=new DurableStore(path,key,'auth',emptyAuth,true);
  const service=()=>new DurableAuth(store,'https://taply.example','pilot.testnet',verifier,()=>now);
  try {
    const c=service().challenge('merchant.testnet'); const signed=testSigner()(c.challenge);
    const outcomes=await Promise.allSettled([service().verify(c.challenge.id,c.browserToken,signed),service().verify(c.challenge.id,c.browserToken,signed)]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    const login=outcomes.find(r=>r.status==='fulfilled')!; assert.equal(login.status,'fulfilled');
    if(login.status!=='fulfilled') throw Error('test');
    store.close(); store=new DurableStore(path,key,'auth',emptyAuth);
    assert.equal(service().session(login.value.token).identity.accountId,'merchant.testnet');
    await assert.rejects(service().verify(c.challenge.id,c.browserToken,signed),/USED/);
    service().logout(login.value.token); assert.throws(()=>service().session(login.value.token),/EXPIRED/);
    const expired=service().challenge('payer.testnet'); now+=120000;
    await assert.rejects(service().verify(expired.challenge.id,expired.browserToken,testSigner()(expired.challenge)),/EXPIRED/);
    service().cleanup();
  } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('durable Handshake draft and idempotency response persist across process store reopen', async () => {
  const dir=mkdtempSync(join(tmpdir(),'taply-session-')), path=join(dir,'test.db'), key=randomBytes(32);
  let store=new SqliteSessionPersistence(path,key,true);
  const deps={contractId:'next.testnet',authenticate:async()=>({accountId:'merchant.testnet'}),readCanonicalRequest:async()=>{throw Error('RPC_UNAVAILABLE');}};
  try {
    const created=await new SessionEngine(store,deps).create({},'persistent_key_0001'); store.close();
    store=new SqliteSessionPersistence(path,key); const engine=new SessionEngine(store,deps);
    assert.deepEqual(await engine.create({},'persistent_key_0001'),created);
    assert.equal((await engine.read({},created.session.id)).state,'DRAFT');
  } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
});
