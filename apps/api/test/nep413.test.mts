import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Challenges } from '../src/auth.mts';
import { createNep413Verifier, nep413Payload, finalizedTestnetKeys } from '../src/nep413.mts';
import { testSigner } from './signer-fixture.mts';
test('NEP-413 published example encodes exact independent Borsh bytes', () => {
  const expected = '9d010080020000006869' + Buffer.from(Array.from({length:32}, (_,i)=>i)).toString('hex')
    + '090000006d796170702e636f6d01120000006d796170702e636f6d2f63616c6c6261636b';
  assert.equal(nep413Payload('hi', Buffer.from(Array.from({length:32},(_,i)=>i)).toString('base64'), 'myapp.com', 'myapp.com/callback').toString('hex'), expected);
});
test('real Ed25519 signature plus independently associated key required; callback bytes bound', async () => {
  const store = new Challenges('https://taply.example', 'pilot.testnet'); const c = store.issue('merchant.testnet');
  const signer = testSigner(); const signed = signer(c); let calls = 0;
  const verifier = createNep413Verifier(c.origin, 'pilot.testnet', async (accountId, publicKey) => {
    calls++; return { accountId, publicKey, blockHash: '1'.repeat(32), blockHeight: '1' };
  });
  assert.equal((await store.consume(c.id, c.accountId, c.origin, c.state, signed, verifier)).accountId, c.accountId);
  await assert.rejects(store.consume(c.id, c.accountId, c.origin, c.state, signed, verifier), /USED/); assert.equal(calls, 1);
  const { message: _message, ...fields } = store.issue('merchant.testnet');
  void _message;
  const callback = { ...fields, callbackUrl: `${c.origin}/auth/callback` };
  const cb = { ...callback, message: JSON.stringify({ ...callback, contractId: 'pilot.testnet' }) };
  await verifier.verify(cb, signer(cb));
  await assert.rejects(verifier.verify({ ...cb, callbackUrl: `${c.origin}/wrong` }, signer(cb)));
});
test('forgery, wrong account/state/origin/recipient, nonce, payload sizes and association fail closed', async () => {
  const c = new Challenges('https://taply.example', 'pilot.testnet').issue('merchant.testnet'); const signed = testSigner()(c);
  const association = async (accountId: string, publicKey: string) => ({ accountId, publicKey, blockHash:'1'.repeat(32), blockHeight:'1' });
  const v = createNep413Verifier(c.origin, 'pilot.testnet', association);
  for (const mutation of [{signature:'A'.repeat(88)}, {accountId:'evil.testnet'}, {state:'evil'}, {publicKey:'ed25519:'+'1'.repeat(32)}, {paid:true}])
    await assert.rejects(v.verify(c, {...signed,...mutation}));
  for (const mutation of [{origin:'https://evil.example'}, {recipient:'evil'}, {nonceBase64:'AA=='}, {message:'x'.repeat(5000)}])
    await assert.rejects(v.verify({...c,...mutation}, signed));
  await assert.rejects(createNep413Verifier(c.origin,'pilot.testnet',async()=>{throw Error('RPC_UNAVAILABLE');}).verify(c,signed), /RPC_UNAVAILABLE/);
  await assert.rejects(createNep413Verifier(c.origin,'pilot.testnet',async()=>({...await association(c.accountId,signed.publicKey),accountId:'evil.testnet'})).verify(c,signed));
  await assert.rejects(createNep413Verifier(c.origin,'pilot.testnet',association,()=>c.expiresAtMs).verify(c,signed), /EXPIRED/);
});
test('finalized Testnet association enforces actual RPC FullAccess, network and anchored key evidence', async () => {
  const hash='1'.repeat(32),publicKey='ed25519:'+hash;
  for(const mode of ['ok','function-call','wrong-block','mainnet','rpc-failure','ambiguous','stale']) {
    const calls: any[]=[];
    const reader=finalizedTestnetKeys(async(url,init)=>{
      assert.equal(url,'https://rpc.testnet.near.org');
      const req=JSON.parse(String(init.body));calls.push(req);
      if(mode==='rpc-failure') throw Error('offline');
      let result: unknown;
      if(req.method==='status') result={chain_id:mode==='mainnet'?'mainnet':'testnet',genesis_hash:'FWJ9kR6KFWoyMoNjpLXXGHeuiy7tEY6GmoFeCA5yuc6b',sync_info:{syncing:false}};
      else if(req.method==='block') result={header:{hash,height:123,timestamp_nanosec:'1793500000000000000'}};
      else if(req.method==='gas_price') result={gas_price:'100000000'};
      else if(req.method==='EXPERIMENTAL_protocol_config') result={runtime_config:{storage_amount_per_byte:'10000000000000000000'}};
      else if(req.params.request_type==='view_access_key') {
        assert.equal(req.params.account_id,'merchant.testnet'); assert.equal(req.params.public_key,publicKey);
        result={nonce:1,permission:mode==='function-call'?{FunctionCall:{}}:mode==='ambiguous'?null:'FullAccess',
          block_hash:mode==='wrong-block'?'2'.repeat(32):hash,block_height:123};
      } else result={amount:'1000000000000000000000000',locked:'0',storage_usage:100,code_hash:hash,block_hash:hash,block_height:123};
      return Response.json({jsonrpc:'2.0',id:req.id,result});
    },()=>1793500000000+(mode==='stale'?120001:0));
    if(mode==='ok') {
      assert.equal((await reader('merchant.testnet',publicKey)).blockHash,hash);
      assert.equal(calls[1].params.finality,'final');
      assert.ok(calls.filter(c=>c.method==='query').every(c=>c.params.block_id===hash));
    } else await assert.rejects(reader('merchant.testnet',publicKey));
    assert.ok(calls.every(c=>!c.method.includes('send')));
  }
});

test('fresh challenges reject revoked keys and accept only the newly associated FullAccess key after rotation', async () => {
  const first = testSigner(), rotated = testSigner();
  const store = new Challenges('https://taply.example', 'candidate.testnet');
  const sample = store.issue('merchant.testnet');
  const firstPublic = first(sample).publicKey, rotatedPublic = rotated(sample).publicKey;
  let active = firstPublic;
  const verifier = createNep413Verifier(sample.origin, 'candidate.testnet', async (accountId, publicKey) => {
    if (publicKey !== active) throw Error('KEY_NOT_ASSOCIATED');
    return { accountId, publicKey, blockHash: '1'.repeat(32), blockHeight: '123' };
  });
  const old = store.issue('merchant.testnet'); active = rotatedPublic;
  await assert.rejects(store.consume(old.id, old.accountId, old.origin, old.state, first(old), verifier), /KEY_NOT_ASSOCIATED/);
  active = firstPublic;
  await assert.rejects(store.consume(old.id, old.accountId, old.origin, old.state, first(old), verifier), /USED/);
  active = rotatedPublic;
  const fresh = store.issue('merchant.testnet');
  assert.equal((await store.consume(fresh.id, fresh.accountId, fresh.origin, fresh.state, rotated(fresh), verifier)).publicKey, rotatedPublic);
  // This tests new login proof only; existing cookies have no continuous key recheck.
});

test('NEP-413 expiry during key lookup burns the challenge and cannot be replayed', async () => {
  const store = new Challenges('https://taply.example', 'candidate.testnet');
  const challenge = store.issue('merchant.testnet'), signed = testSigner()(challenge);
  let now = challenge.expiresAtMs - 1, calls = 0;
  const verifier = createNep413Verifier(challenge.origin, 'candidate.testnet', async (accountId, publicKey) => {
    calls++; now = challenge.expiresAtMs;
    return { accountId, publicKey, blockHash: '1'.repeat(32), blockHeight: '123' };
  }, () => now);
  await assert.rejects(store.consume(challenge.id, challenge.accountId, challenge.origin, challenge.state, signed, verifier), /EXPIRED/);
  now = challenge.expiresAtMs - 1;
  await assert.rejects(store.consume(challenge.id, challenge.accountId, challenge.origin, challenge.state, signed, verifier), /USED/);
  assert.equal(calls, 1);
});
