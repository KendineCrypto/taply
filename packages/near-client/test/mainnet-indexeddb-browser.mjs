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
const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0,fs:{allow:[root]},watch:{ignored:['**/artifacts/**','**/.git/**']}},logLevel:'error'});
server.middlewares.use('/attempt-test',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Mainnet IndexedDB test</title>');});
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
  writeFileSync(resolve(output,'indexeddb-results.json'),JSON.stringify({passed:checks.length,checks,evidence:'real Chromium IndexedDB, synthetic identities; no signing or broadcast'},null,2));
  console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await context?.close();await server.close();}
