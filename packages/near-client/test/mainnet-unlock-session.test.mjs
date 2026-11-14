import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EncryptedMainnetVault, MAINNET_VAULT_UNLOCK_MS } from '../dist/index.js';
const password = 'synthetic local password';
const storage = () => { const m = new Map(); return { getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v) }; };
const sessions = () => { let saved=null; return { save:async s=>{saved=structuredClone(s);}, load:async()=>saved, clear:async()=>{saved=null;} }; };

test('Mainnet reload resumes a nonextractable session without extending the original expiry', async () => {
  let now=1000; const data=storage(), session=sessions();
  const first=new EncryptedMainnetVault(data,{session,now:()=>now});
  await first.create(password); await first.unlock(password);
  const saved=await session.load(); assert.equal(saved.key.extractable,false);
  assert.equal(saved.expiresAt,1000+MAINNET_VAULT_UNLOCK_MS);
  first.release(); now+=1000;
  const second=new EncryptedMainnetVault(data,{session,now:()=>now});
  const events=[]; second.subscribe(()=>events.push(second.unlocked));
  assert.equal(await second.resume(),true); assert.equal(second.unlocked,true);
  assert.deepEqual(events,[true]); assert.equal((await session.load()).expiresAt,saved.expiresAt);
  now=saved.expiresAt; assert.equal(second.unlocked,false);
  assert.equal(await new EncryptedMainnetVault(data,{session,now:()=>now}).resume(),false);
});

test('explicit lock prevents reload resume; unlocking notifies subscribers', async () => {
  const data=storage(),session=sessions(),v=new EncryptedMainnetVault(data,{session});
  await v.create(password); const states=[]; v.subscribe(()=>states.push(v.unlocked));
  await v.unlock(password); assert.equal(states.at(-1),true);
  v.lock(); assert.equal(states.at(-1),false);
  assert.equal(await new EncryptedMainnetVault(data,{session}).resume(),false);
});

test('a session for a replaced vault record cannot unlock the replacement', async () => {
  const data=storage(),session=sessions(),v=new EncryptedMainnetVault(data,{session});
  await v.create(password); await v.unlock(password); v.release();
  const other=new EncryptedMainnetVault(storage()); await other.create(password);
  data.setItem('taply.mainnet-vault.v1',other.exportEncryptedBackup());
  assert.equal(await new EncryptedMainnetVault(data,{session}).resume(),false);
  assert.equal(await session.load(),null);
});
