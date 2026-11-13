import {MainnetAccountSchema,parseStrictJson} from '../../../packages/shared/dist/index.js';
import type {RedisCommand} from './redis-store.mts';

// One permanent account record. No expiry, retry loop, clearing or force write.
const CAS=`local old = redis.call('GET', KEYS[1])
if redis.call('PTTL', KEYS[1]) >= 0 then return -1 end
if ARGV[1] == 'missing' then
  if old then return 0 end
elseif old ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[3])
return 1`;
/** SERVER ONLY. Bind to an authenticated Mainnet account before constructing.
 * Run the coordinator and chain reconciliation on the server; NEVER publish a
 * raw CAS endpoint accepting browser-supplied ledger/terminal proof JSON.
 * Redis must provide durable no-eviction storage with independent rollback
 * protection. This adapter does not claim those operational guarantees. */
export function createMainnetGlobalRedisStore(command:RedisCommand,authenticatedAccountId:string){
  const account=MainnetAccountSchema.parse(authenticatedAccountId),key=`taply:mainnet:wallet:v2:${account}`;
  const scoped=(id:string)=>{if(id!==account)throw Error('UNAUTHORIZED_ACCOUNT');};
  return Object.freeze({scope:'account-global' as const,
    async read(id:string):Promise<string|null>{scoped(id);const result=await command(['GET',key]);
      if(result!==null&&typeof result!=='string')throw Error('INVALID_LEDGER');return result;},
    async compareAndSwap(id:string,expected:string|null,next:string):Promise<boolean>{
      scoped(id);if(next.length>65536)throw Error('ARCHIVE_REQUIRED');
      const value=parseStrictJson(next) as {network?:unknown;accountId?:unknown;version?:unknown};
      if(value.network!=='near-mainnet'||value.accountId!==account||value.version!==2)throw Error('INVALID_LEDGER');
      const result=await command(['EVAL',CAS,'1',key,expected===null?'missing':'present',expected??'',next]);
      if(result!==0&&result!==1)throw Error('DURABILITY_UNAVAILABLE');return result===1;
    },
  });
}
