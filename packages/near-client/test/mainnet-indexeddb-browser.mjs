import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../../..');
const require=createRequire(realpathSync(resolve(root,'apps/web/node_modules/vitest/package.json')));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])).href);
const output=resolve(process.argv[3]);mkdirSync(output,{recursive:true});
const server=await createServer({root,configFile:false,plugins:[{name:'test-only-authority',configureServer(s){s.middlewares.use('/test-global-cas',globalCas);}}],server:{host:'127.0.0.1',port:0,fs:{allow:[root]},watch:{ignored:['**/artifacts/**','**/.git/**','**/.phase4-evidence/**']}},logLevel:'error'});
server.middlewares.use('/attempt-test',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Mainnet IndexedDB test</title>');});
// Test-only shared authority. Production must never expose a raw CAS endpoint.
// Redis durability is tested separately; this harness proves browser behavior.
let globalLedger=null;
async function globalCas(req,res){
  let text='';for await(const bytes of req){text+=bytes;if(text.length>65536){res.statusCode=413;res.end();return;}}
  const command=JSON.parse(text),old=globalLedger;
  if(command.kind==='cas'&&command.expected===old)globalLedger=command.next;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(command.kind==='read'?old:command.expected===old));
}
await server.listen();const url=`http://127.0.0.1:${server.httpServer.address().port}/attempt-test`;
const userData=resolve(output,`profile-${Date.now()}`);
let context;const checks=[];
async function page(){const p=await context.newPage();await p.goto(url);await p.evaluate(async()=>{
  const m=await import('/packages/near-client/src/mainnet-attempts.ts');window.store=await m.openMainnetAttemptStore();window.journal=m.createMainnetAttemptJournal(window.store);
});return p;}
try{
  context=await chromium.launchPersistentContext(userData,{headless:true});
  const a=await page(),b=await page();
  const attempts=await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).evaluate(async()=>{
    try{return await window.journal.reserve('alice.near','a'.repeat(64));}catch{return null;}
  })));
  assert.equal(attempts.filter(Boolean).length,1);checks.push('20 cross-tab reservations admit exactly one');
  const attempt=await a.evaluate(()=>window.journal.read('alice.near'));
  await a.evaluate(async()=>{const x=await window.journal.read('alice.near');await window.journal.transition(x,'HANDOFF');});
  assert.equal(await b.evaluate(async old=>{try{await window.journal.transition(old,'HANDOFF');return false;}catch{return true;}},attempt),true);
  checks.push('stale reservation cannot hand off twice');
  const cdp=await context.newCDPSession(a),crashed=a.waitForEvent('crash',{timeout:10000});
  void cdp.send('Page.crash').catch(()=>{});await crashed;
  const survivor=await page();assert.equal((await survivor.evaluate(()=>window.journal.read('alice.near'))).state,'HANDOFF');
  checks.push('acknowledged handoff survives renderer crash');
  await context.close();context=await chromium.launchPersistentContext(userData,{headless:true});
  const restarted=await page();assert.equal((await restarted.evaluate(()=>window.journal.read('alice.near'))).state,'HANDOFF');
  assert.equal(await restarted.evaluate(async()=>{try{await window.journal.reserve('alice.near','b'.repeat(64));return false;}catch{return true;}}),true);
  checks.push('browser restart preserves pending attempt and blocks replacement');
  async function v2page(deviceId){
    const p=await context.newPage();await p.goto(url);await p.evaluate(async deviceId=>{
      const {createMainnetTransactionCoordinator}=await import('/packages/near-client/src/mainnet-reconciliation.ts');
      const command=async value=>(await fetch('/test-global-cas',{method:'POST',body:JSON.stringify(value)})).json();
      window.coordinator=createMainnetTransactionCoordinator({deviceId,profile:{network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'browser-test'},
        store:{scope:'account-global',read:()=>command({kind:'read'}),compareAndSwap:(_,expected,next)=>command({kind:'cas',expected,next})}},async()=>{throw Error('offline');});
      window.expectation={accountId:'alice.near',publicKey:'ed25519:11111111111111111111111111111111',receiverId:'bob.near',action:{kind:'transfer',depositYocto:'1'},nonce:'8',minimumNonce:'7',anchorHash:'1'.repeat(31)+'2',anchorHeight:'100'};
    },deviceId);return p;
  }
  const owner=crypto.randomUUID(),v2a=await v2page(owner),v2b=await v2page(owner);
  const reservations=await Promise.all(Array.from({length:20},(_,i)=>(i%2?v2a:v2b).evaluate(async()=>{try{return await window.coordinator.reserve('a'.repeat(64),window.expectation);}catch(e){return {error:e.message};}})));
  assert.equal(reservations.filter(r=>r.attemptId).length,1,JSON.stringify(reservations));checks.push('v2 account-global CAS: 20 reservations across real tabs admit one');
  await v2a.evaluate(async()=>{const {pending}=await window.coordinator.read('alice.near');await window.coordinator.handoff(pending,null);});
  const v2cdp=await context.newCDPSession(v2a),v2crash=v2a.waitForEvent('crash',{timeout:10000});void v2cdp.send('Page.crash').catch(()=>{});await v2crash;
  assert.equal((await v2b.evaluate(()=>window.coordinator.read('alice.near'))).pending.state,'HANDOFF');
  await context.close();context=await chromium.launchPersistentContext(userData,{headless:true});
  const v2restart=await v2page(owner);assert.equal((await v2restart.evaluate(()=>window.coordinator.read('alice.near'))).pending.state,'HANDOFF');
  assert.equal((await v2restart.evaluate(()=>window.coordinator.reconcile('alice.near'))).kind,'OUTCOME_UNRESOLVED');
  checks.push('v2 renderer crash and browser restart preserve unknown handoff; offline is not failure');
  const other=await v2page(crypto.randomUUID());assert.equal(await other.evaluate(async()=>{try{await window.coordinator.reserve('b'.repeat(64),window.expectation);return false;}catch(e){return e.message==='OTHER_DEVICE_READ_ONLY';}}),true);
  checks.push('v2 second device cannot take over or pay while first device outcome is unknown');
  writeFileSync(resolve(output,'indexeddb-results.json'),JSON.stringify({passed:checks.length,checks,evidence:'real Chromium IndexedDB, synthetic identities; no signing or broadcast'},null,2));
  console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await context?.close();await server.close();}
