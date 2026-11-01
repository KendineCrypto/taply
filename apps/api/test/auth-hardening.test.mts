import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableStore } from '../src/storage.mts';
import { DurableAuth, emptyAuth } from '../src/durable-auth.mts';
import { createNep413Verifier } from '../src/nep413.mts';
import { testSigner } from './signer-fixture.mts';

test('origin/contract scope, token rotation, logout and pending login race fail closed', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taply-auth-review-')),key=randomBytes(32);
  const store=new DurableStore(join(dir,'test.db'),key,'auth',emptyAuth,true);
  let pause=false,entered!:()=>void,release!:()=>void;
  const reached=new Promise<void>(resolve=>{entered=resolve;});
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const verifier=createNep413Verifier('https://taply.example','pilot.testnet',async(accountId,publicKey)=>{
    if(pause){entered();await blocked;}
    return {accountId,publicKey,blockHash:'1'.repeat(32),blockHeight:'1'};
  });
  const auth=new DurableAuth(store,'https://taply.example','pilot.testnet',verifier);
  const login=async(replace?:string)=>{const c=auth.challenge('merchant.testnet');
    return auth.verify(c.challenge.id,c.browserToken,testSigner()(c.challenge),replace);};
  try {
    const first=await login(); const second=await login(first.token);
    assert.notEqual(first.token,second.token); assert.notEqual(first.csrf,second.csrf);
    assert.throws(()=>auth.session(first.token),/AUTH_EXPIRED/);
    for(const [origin,contract] of [['https://other.example','pilot.testnet'],['https://taply.example','other.testnet']])
      assert.throws(()=>new DurableAuth(store,origin,contract,verifier).session(second.token),/AUTH_EXPIRED/);
    pause=true; const pending=login(); await reached; auth.logout(second.token); release();
    await assert.rejects(pending,/AUTH_CHALLENGE_USED/);
    assert.throws(()=>auth.session(second.token),/AUTH_EXPIRED/);
    assert.equal(store.transaction(db=>db.sessions.size),0);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
