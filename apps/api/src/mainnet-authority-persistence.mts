import {createHash} from 'node:crypto';
import {canonicalJson,parseStrictJson,MainnetAccountSchema} from '../../../packages/shared/dist/index.js';
import type {FreshnessAuthority,FreshnessAnchor} from './freshness.mts';
import type {RedisCommand} from './redis-store.mts';

export type AuthorityRecord={epoch:string;revision:string;payload:string};
export interface AuthorityPersistence {
  read():Promise<AuthorityRecord>;
  compareAndSwap(expected:AuthorityRecord,payload:string):Promise<boolean>;
}
export function authorityAnchor(accountId:string,record:AuthorityRecord):FreshnessAnchor {
  MainnetAccountSchema.parse(accountId);
  if(!/^[a-f0-9]{64}$/.test(record.epoch)||!/^(0|[1-9][0-9]{0,19})$/.test(record.revision)||
    BigInt(record.revision)>18446744073709551615n||typeof record.payload!=='string'||Buffer.byteLength(record.payload)>262144)throw Error('INVALID_AUTHORITY_RECORD');
  return {epoch:record.epoch,revision:record.revision,digest:createHash('sha256').update('taply.mainnet.authority.v1\n'+accountId+'\n'+canonicalJson(record)).digest('hex')};
}
const same=(a:FreshnessAnchor,b:FreshnessAnchor)=>canonicalJson(a)===canonicalJson(b);
const READ=`if redis.call('PTTL',KEYS[1]) ~= -1 then return false end
return redis.call('GET',KEYS[1])`;
const CAS=`if redis.call('PTTL',KEYS[1]) ~= -1 then return -1 end
if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[2]); return 1`;
/** SERVER ONLY. Independently provision BOTH initial records before use. Missing
 * records never initialize themselves. Witness must be linearizable, permanent,
 * and outside Redis's restore/admin domain (see FreshnessAuthority). A second
 * Redis key/replica is insufficient. No provider or production route is enabled.
 * Witness advances BEFORE Redis: crash/lost acknowledgement fences the account.
 * Recovery may restore only the exact witnessed payload, never reset its head. */
export function createFencedMainnetRedisPersistence(command:RedisCommand,accountId:string,witness:FreshnessAuthority):AuthorityPersistence {
  MainnetAccountSchema.parse(accountId);
  const scope=`taply.mainnet.authority:${accountId}`,key=`taply:mainnet:authority:v1:${accountId}`;
  let unhealthy=false;
  return Object.freeze({
    async read(){
      if(unhealthy)throw Error('AUTHORITY_RECOVERY_REQUIRED');
      try {
        const head=await witness.read(scope),raw=await command(['EVAL',READ,'1',key]);
        if(typeof raw!=='string'||Buffer.byteLength(raw)>300000)throw Error('AUTHORITY_RECOVERY_REQUIRED');
        const record=parseStrictJson(raw) as AuthorityRecord;
        if(Object.keys(record).sort().join()!=='epoch,payload,revision'||!same(head,authorityAnchor(accountId,record))||
          !same(head,await witness.read(scope)))throw Error('AUTHORITY_RECOVERY_REQUIRED');
        return record;
      }catch(error){unhealthy=true;throw error;}
    },
    async compareAndSwap(expected:AuthorityRecord,payload:string){
      if(unhealthy)throw Error('AUTHORITY_RECOVERY_REQUIRED');
      const previous=authorityAnchor(accountId,expected),next={...expected,revision:String(BigInt(expected.revision)+1n),payload};
      const anchor=authorityAnchor(accountId,next);
      try {
        if(!await witness.compareAndSwap(scope,previous,anchor))return false;
        const result=await command(['EVAL',CAS,'1',key,canonicalJson(expected),canonicalJson(next)]);
        if(result!==1||!same(anchor,await witness.read(scope)))throw Error('AUTHORITY_RECOVERY_REQUIRED');
        return true;
      }catch(error){unhealthy=true;throw error;}
    },
  });
}
