import {createHash,createPublicKey,randomBytes,randomUUID,verify} from 'node:crypto';
import {canonicalJson,parseStrictJson,MainnetAccountSchema} from '../../../packages/shared/dist/index.js';
import {createMainnetWalletChain,type MainnetSigningProfiles,type MainnetWalletAuthority} from '../../../packages/near-client/dist/index.js';
import {base64,nep413Payload,publicBytes} from './nep413.mts';
import {createMainnetWalletAuthority} from './mainnet-wallet-authority.mts';
import type {AuthorityPersistence,AuthorityRecord} from './mainnet-authority-persistence.mts';

export type MainnetAuthorityCommand=
 | {method:'read'}
 | {method:'reserve';args:Parameters<MainnetWalletAuthority['reserve']>}
 | {method:'handoff';args:Parameters<MainnetWalletAuthority['handoff']>}
 | {method:'uncertain';args:Parameters<MainnetWalletAuthority['uncertain']>}
 | {method:'reconcile';hashHint?:string};
export type MainnetAuthorityChallenge={id:string;network:'near-mainnet';purpose:'taply-wallet-authority-v1';origin:string;
 accountId:string;publicKey:string;deviceId:string;nonceBase64:string;expiresAtMs:number;commandHash:string;policyHash:string;
 recipient:string;message:string};
type Pending={challenge:MainnetAuthorityChallenge;deviceHash:string;used:boolean};
type State={version:1;accountId:string;ownerDeviceId:string|null;ledger:string|null;devices:Record<string,string>;challenges:Pending[]};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const tokenOK=(s:string)=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
/** Provisioning input only. Request handling NEVER invokes this on missing data. */
export function initialMainnetAuthorityState(accountId:string):string {
  MainnetAccountSchema.parse(accountId);return canonicalJson({version:1,accountId,ownerDeviceId:null,ledger:null,devices:{},challenges:[]});
}
function command(value:MainnetAuthorityCommand):MainnetAuthorityCommand {
  const raw=canonicalJson(value);if(Buffer.byteLength(raw)>32768)throw Error('INVALID_COMMAND');
  const c=parseStrictJson(raw) as MainnetAuthorityCommand;
  const keys=Object.keys(c).sort().join();
  if(c.method==='read'&&keys==='method')return c;
  if(c.method==='reconcile'&&(keys==='method'||keys==='hashHint,method')&&
    (c.hashHint===undefined||/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(c.hashHint)))return c;
  if(['reserve','handoff','uncertain'].includes(c.method)&&keys==='args,method'&&'args' in c&&Array.isArray(c.args)&&
    c.args.length===(c.method==='reserve'?3:2))return c;
  throw Error('INVALID_COMMAND');
}
/** No bearer principal or client account/device claims. Each operation needs a
 * single-use NEP-413 wallet proof AND possession of its server-issued device
 * credential. Enrollment binds those credentials; another device is read-only.
 * Signed command digests bind exact semantic input, NOT arbitrary transactions.
 * No transaction signer, production endpoint, migration or takeover is supplied. */
export function createAuthenticatedMainnetAuthority(input:{accountId:string;origin:string;profiles:MainnetSigningProfiles;
 persistence:AuthorityPersistence},fetcher:typeof fetch=globalThis.fetch,now=Date.now){
  const {accountId,origin,persistence}=input,profiles=structuredClone(input.profiles);
  MainnetAccountSchema.parse(accountId);
  if(origin!=='https://mainnet.taplyapp.xyz')throw Error('INVALID_ORIGIN');
  const policyHash=hash(canonicalJson(profiles)),chain=createMainnetWalletChain(profiles.network,fetcher);
  async function read(){
    const record=await persistence.read(),state=parseStrictJson(record.payload) as State;
    if(state.version!==1||state.accountId!==accountId||!Array.isArray(state.challenges)||state.challenges.length>32||
      !state.devices||typeof state.devices!=='object'||Object.keys(state.devices).length>16||
      (state.ledger!==null&&typeof state.ledger!=='string'))throw Error('AUTHORITY_RECOVERY_REQUIRED');
    return {record,state};
  }
  async function save(record:AuthorityRecord,state:State){
    if(!await persistence.compareAndSwap(record,canonicalJson(state)))throw Error('AUTHORITY_CONFLICT');
  }
  function exactOrigin(value:string){if(value!==origin)throw Error('INVALID_ORIGIN');}
  return Object.freeze({
    async challenge(requestOrigin:string,publicKey:string,proposed:MainnetAuthorityCommand,deviceCredential?:string){
      exactOrigin(requestOrigin);publicBytes(publicKey);const c=command(proposed),{record,state}=await read();
      const credential=deviceCredential===undefined?token():deviceCredential;
      if(!tokenOK(credential))throw Error('INVALID_DEVICE');
      const deviceHash=hash(credential),deviceId=state.devices[deviceHash]??randomUUID();
      const fields={id:randomUUID(),network:'near-mainnet' as const,purpose:'taply-wallet-authority-v1' as const,origin,
        accountId,publicKey,deviceId,nonceBase64:randomBytes(32).toString('base64'),expiresAtMs:now()+120000,
        commandHash:hash(canonicalJson(c)),policyHash,recipient:origin};
      const challenge={...fields,message:canonicalJson(fields)};
      state.challenges=state.challenges.filter(x=>x.challenge.expiresAtMs>now());
      if(state.challenges.length>=32)throw Error('RATE_LIMITED');
      state.challenges.push({challenge,deviceHash,used:false});await save(record,state);
      return {challenge,deviceCredential:credential};
    },
    async execute(requestOrigin:string,deviceCredential:string,id:string,proposed:MainnetAuthorityCommand,
      signed:{accountId:string;publicKey:string;signature:string}){
      exactOrigin(requestOrigin);if(!tokenOK(deviceCredential))throw Error('INVALID_DEVICE');
      const c=command(proposed),first=await read(),pending=first.state.challenges.find(x=>x.challenge.id===id);
      if(!pending||pending.used||pending.deviceHash!==hash(deviceCredential))throw Error('AUTH_CHALLENGE_USED');
      const challenge=pending.challenge;
      if(challenge.commandHash!==hash(canonicalJson(c))||challenge.policyHash!==policyHash||challenge.origin!==origin||
        challenge.accountId!==accountId||challenge.network!=='near-mainnet'||challenge.purpose!=='taply-wallet-authority-v1')throw Error('INVALID_CHALLENGE');
      // Consume durably BEFORE crypto/RPC. Even a lost response or failed proof
      // cannot replay. Auth expiry does not clear a wallet attempt.
      pending.used=true;await save(first.record,first.state);
      if(now()>=challenge.expiresAtMs)throw Error('AUTH_CHALLENGE_EXPIRED');
      if(Object.keys(signed).sort().join()!=='accountId,publicKey,signature'||signed.accountId!==accountId||signed.publicKey!==challenge.publicKey)throw Error('AUTH_SIGNATURE_INVALID');
      const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes(signed.publicKey)]),format:'der',type:'spki'});
      if(!verify(null,createHash('sha256').update(nep413Payload(challenge.message,challenge.nonceBase64,challenge.recipient)).digest(),key,base64(signed.signature,64)))throw Error('AUTH_SIGNATURE_INVALID');
      const snapshot=await chain.snapshot(accountId,signed.publicKey);
      const age=snapshot?BigInt(now())*1000000n-BigInt(snapshot.blockTimestampNs):0n;
      if(!snapshot||age< -30000000000n||age>120000000000n)throw Error('KEY_VERIFICATION_UNAVAILABLE');
      if(now()>=challenge.expiresAtMs)throw Error('AUTH_CHALLENGE_EXPIRED');
      const enrolled=await read(),deviceHash=pending.deviceHash;
      const existing=enrolled.state.devices[deviceHash];
      if(existing!==undefined&&existing!==challenge.deviceId)throw Error('INVALID_DEVICE');
      if(existing===undefined){
        if(Object.keys(enrolled.state.devices).length>=16)throw Error('DEVICE_LIMIT');
        enrolled.state.devices[deviceHash]=challenge.deviceId;
        enrolled.state.ownerDeviceId??=challenge.deviceId;
        await save(enrolled.record,enrolled.state);
      }
      if(c.method!=='read'&&c.method!=='reconcile'&&enrolled.state.ownerDeviceId!==challenge.deviceId)throw Error('OTHER_DEVICE_READ_ONLY');
      const store={scope:'account-global' as const,
        async read(id:string){if(id!==accountId)throw Error('UNAUTHORIZED_ACCOUNT');return (await read()).state.ledger;},
        async compareAndSwap(id:string,expected:string|null,next:string){
          if(id!==accountId)throw Error('UNAUTHORIZED_ACCOUNT');
          const current=await read();if(current.state.ledger!==expected)return false;
          current.state.ledger=next;return persistence.compareAndSwap(current.record,canonicalJson(current.state));
        }};
      const authority=createMainnetWalletAuthority({principal:{accountId,publicKey:signed.publicKey,deviceId:challenge.deviceId},profiles,store},fetcher);
      if(c.method==='read')return authority.read(accountId);
      if(c.method==='reconcile')return authority.reconcile(accountId,c.hashHint);
      if(c.method==='reserve')return authority.reserve(...c.args);
      if(c.method==='handoff')return authority.handoff(...c.args);
      return authority.uncertain(...c.args);
    },
  });
}
