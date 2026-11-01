import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createCipheriv } from 'node:crypto';
import { serialize } from 'node:v8';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { DurableStore, SqliteSessionPersistence } from '../src/storage.mts';
import { DurableAuth, emptyAuth } from '../src/durable-auth.mts';
import { createNep413Verifier } from '../src/nep413.mts';
import { testSigner } from './signer-fixture.mts';
import { SessionEngine } from '../src/sessions.mts';
import { calculateRequestId, calculateTermsHash, calculateSessionCommitment } from '../../../packages/shared/dist/index.js';

test('demonstrates valid-backup rollback replays consumed auth and resurrects logout: external freshness required', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taply-rollback-')),path=join(dir,'test.db'),key=randomBytes(32);
  const verifier=createNep413Verifier('https://taply.example','pilot.testnet',async(accountId,publicKey)=>({accountId,publicKey,blockHash:'1'.repeat(32),blockHeight:'1'}));
  let db=new DurableStore(path,key,'auth',emptyAuth,true);
  const auth=()=>new DurableAuth(db,'https://taply.example','pilot.testnet',verifier);
  const reopen=()=>{db=new DurableStore(path,key,'auth',emptyAuth);};
  try {
    const c=auth().challenge('merchant.testnet'),signed=testSigner()(c.challenge);
    db.close(); const unconsumed=readFileSync(path);reopen();
    const login=await auth().verify(c.challenge.id,c.browserToken,signed);
    db.close(); const activeSession=readFileSync(path);reopen();
    auth().logout(login.token);assert.throws(()=>auth().session(login.token));
    await assert.rejects(auth().verify(c.challenge.id,c.browserToken,signed));
    db.close();writeFileSync(path,activeSession);reopen();
    assert.equal(auth().session(login.token).identity.accountId,'merchant.testnet');
    db.close();writeFileSync(path,unconsumed);reopen();
    assert.equal((await auth().verify(c.challenge.id,c.browserToken,signed)).identity.accountId,'merchant.testnet');
    // Expected vulnerability proof, NOT an assertion of rollback resistance.
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('demonstrates valid-backup rollback re-enables a consumed join token',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taply-join-rollback-')),path=join(dir,'test.db'),key=randomBytes(32),now=Date.now();
  let db=new SqliteSessionPersistence(path,key,true);let record: any;
  const deps={contractId:'payments.fixture.testnet',now:()=>now,
    authenticate:async(c:unknown)=>({accountId:String(c)}),readCanonicalRequest:async()=>record};
  const engine=()=>new SessionEngine(db,deps);
  try {
    const created=await engine().create('alice.testnet','rollback_create_key');const s=created.session;
    const terms=JSON.parse(readFileSync(new URL('../../../packages/shared/test-vectors/intent-a.json',import.meta.url),'utf8'));
    Object.assign(terms,{mode:'instant',cancelDurationNs:null,fundingExpiresAtNs:String(BigInt(now+180000)*1000000n),sessionBinding:{id:s.id,nonce:s.nonce,expiresAtNs:s.expiresAtNs}});
    const {contractId,creationNonce,creatorAccountId,network}=terms;
    terms.id=calculateRequestId({contractId,creationNonce,creatorAccountId,network});
    record={terms,termsHash:calculateTermsHash(terms),sessionCommitment:calculateSessionCommitment(terms),recipientAccountId:'alice.testnet',status:'OPEN',revision:'1',createdAtNs:String(BigInt(now)*1000000n),payerAccountId:null,fundedAtNs:null,cancelUntilNs:null,settlementBranch:null,latestOperation:null};
    await engine().bind('alice.testnet',s.id,'rollback_bind_key',{intentId:terms.id,termsHash:record.termsHash});
    db.close();const beforeJoin=readFileSync(path);db=new SqliteSessionPersistence(path,key);
    await engine().join('bob.testnet',s.id,'rollback_join_key',{joinToken:created.joinToken});
    await assert.rejects(engine().join('eve.testnet',s.id,'rollback_join_key',{joinToken:created.joinToken}),/JOIN_TOKEN_USED/);
    db.close();writeFileSync(path,beforeJoin);db=new SqliteSessionPersistence(path,key);
    assert.equal((await engine().join('eve.testnet',s.id,'rollback_join_key',{joinToken:created.joinToken})).payerAccountId,'eve.testnet');
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('abrupt process death rolls back uncommitted SQL and retains committed WAL',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taply-crash-')),path=join(dir,'test.db'),key=randomBytes(32);
  const first=new DurableStore(path,key,'test',()=>({n:0}),true);first.close();
  const env={...process.env,TAPLY_TEST_DB:path,TAPLY_TEST_KEY:key.toString('hex')};
  try {
    const before=spawnSync(process.execPath,['--input-type=module','-e',
      `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.env.TAPLY_TEST_DB);db.exec('BEGIN IMMEDIATE');db.prepare('UPDATE state SET payload=zeroblob(32) WHERE name=?').run('test');process.exit(73);`],{env});
    assert.equal(before.status,73);
    const unchanged=new DurableStore(path,key,'test',()=>({n:0}));assert.equal(unchanged.transaction(s=>s.n),0);unchanged.close();
    const after=spawnSync(process.execPath,['--input-type=module','-e',
      `import {DurableStore} from ${JSON.stringify(new URL('../src/storage.mts',import.meta.url).href)};const db=new DurableStore(process.env.TAPLY_TEST_DB,Buffer.from(process.env.TAPLY_TEST_KEY,'hex'),'test',()=>({n:0}));db.transaction(s=>{s.n++;});process.exit(74);`],{env});
    assert.equal(after.status,74);
    const recovered=new DurableStore(path,key,'test',()=>({n:0}));assert.equal(recovered.transaction(s=>s.n),1);recovered.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('legacy/future formats refuse migration, corruption poisons live connection, rotation needs a new store',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taply-format-')),path=join(dir,'test.db'),key=randomBytes(32);
  let db=new DurableStore(path,key,'test',()=>({n:0}),true);
  try {
    const raw=new DatabaseSync(path);raw.prepare('UPDATE state SET payload=zeroblob(32) WHERE name=?').run('test');
    assert.throws(()=>db.transaction(s=>s.n));
    assert.throws(()=>db.transaction(s=>s.n),/VERIFICATION_UNAVAILABLE/);db.close();
    for(const format of ['legacy','future']) {
      const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
      cipher.setAAD(Buffer.from(`taply.storage.${format==='legacy'?'v1':'v2'}:test`));
      const content=format==='legacy'?{n:0}:{format:'taply.storage.v3',namespace:'test',state:{n:0}};
      const ciphertext=Buffer.concat([cipher.update(serialize(content)),cipher.final()]);
      const bytes=Buffer.concat([nonce,cipher.getAuthTag(),ciphertext]);
      raw.prepare('UPDATE state SET payload=? WHERE name=?').run(bytes,'test');
      assert.throws(()=>new DurableStore(path,key,'test',()=>({n:0}),true));
      assert.deepEqual(Buffer.from(raw.prepare('SELECT payload FROM state WHERE name=?').get('test')!.payload as Uint8Array),bytes);
    } raw.close();
    assert.throws(()=>new DurableStore(path,randomBytes(32),'test',()=>({n:0})));
    db=new DurableStore(join(dir,'new-epoch.db'),randomBytes(32),'test',()=>({n:0}),true);
    assert.equal(db.transaction(s=>s.n),0);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
test('POSIX permissions must be private (Windows ACLs remain an explicit hosting gate)',{skip:process.platform==='win32'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'taply-mode-')),path=join(dir,'test.db'),key=randomBytes(32);
  try {
    const db=new DurableStore(path,key,'test',()=>({n:0}),true);db.close();chmodSync(path,0o644);
    assert.throws(()=>new DurableStore(path,key,'test',()=>({n:0})),/VERIFICATION_UNAVAILABLE/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
