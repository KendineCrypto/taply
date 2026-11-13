import {parseStrictJson} from '../../../packages/shared/dist/index.js';
import {createHash} from 'node:crypto';
import type {RedisCommand} from './redis-store.mts';
import type {createAuthenticatedMainnetAuthority,MainnetAuthorityCommand} from './mainnet-authenticated-authority.mts';

export interface MainnetAuthorityRateLimiter {
  /** Must atomically enforce global, trusted-IP and account budgets. Reject on
   * storage failure. IP comes from reviewed server infrastructure, never JSON
   * or an unvalidated forwarded header. Run BEFORE reading bodies or RPC. */
  consume(trustedIp:string,accountId:string):Promise<void>;
}
const RATE=`for i=1,3 do
local n=redis.call('INCR',KEYS[i]); if n==1 then redis.call('PEXPIRE',KEYS[i],60000) end
if n>tonumber(ARGV[i]) then return 0 end
end; return 1`;
/** Rate buckets may expire; attempt/enrollment records never do. */
export function createMainnetAuthorityRateLimiter(redis:RedisCommand):MainnetAuthorityRateLimiter {
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  return {async consume(ip,accountId){
    if(!ip||ip.length>128)throw Error('RATE_LIMITED');
    const prefix='taply:mainnet:authority:rate:';
    if(await redis(['EVAL',RATE,'3',prefix+'global',prefix+'ip:'+hash(ip),prefix+'account:'+hash(accountId),'600','60','30'])!==1)throw Error('RATE_LIMITED');
  }};
}
async function body(request:Request){
  if(request.headers.get('content-type')!=='application/json'||request.headers.has('content-encoding'))throw Error('INVALID_BODY');
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||BigInt(length)>65536n))throw Error('BODY_LIMIT');
  const reader=request.body?.getReader();if(!reader)throw Error('INVALID_BODY');
  const chunks:Uint8Array[]=[];let bytes=0,timer:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([(async()=>{
      for(;;){const part=await reader.read();if(part.done)break;
        bytes+=part.value.byteLength;if(bytes>65536)throw Error('BODY_LIMIT');chunks.push(part.value);}
      return parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('BODY_TIMEOUT')),3000);})]);
  }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const COOKIE='__Host-taply-mainnet-device';
/** Unmounted development adapter. Existing production refusal handler remains
 * unchanged. No CORS, redirects, query credentials, raw CAS or signing endpoint.
 * A browser sends its HttpOnly device cookie and NEP-413 signed command proof. */
export function createMainnetAuthorityHttp(service:ReturnType<typeof createAuthenticatedMainnetAuthority>,accountId:string,limiter:MainnetAuthorityRateLimiter){
  return async(request:Request,trustedIp:string):Promise<Response>=>{
    try {
      const url=new URL(request.url),origin=request.headers.get('origin');
      if(url.origin!=='https://mainnet.taplyapp.xyz'||origin!==url.origin||url.search||request.method!=='POST'||
        !['/api/mainnet/authority/challenge','/api/mainnet/authority/execute'].includes(url.pathname))return Response.json({error:'NOT_AUTHORIZED'},{status:403,headers});
      await limiter.consume(trustedIp,accountId);
      const cookies=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));
      if(cookies.length>1)throw Error('INVALID_DEVICE');const credential=cookies[0]?.slice(COOKIE.length+1);
      const value=await body(request) as Record<string,unknown>;
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_BODY');
      if(url.pathname.endsWith('/challenge')){
        if(Object.keys(value).sort().join()!=='command,publicKey'||typeof value.publicKey!=='string')throw Error('INVALID_BODY');
        const result=await service.challenge(origin,value.publicKey,value.command as MainnetAuthorityCommand,credential);
        return Response.json(result.challenge,{headers:{...headers,'Set-Cookie':`${COOKIE}=${result.deviceCredential}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000`}});
      }
      if(Object.keys(value).sort().join()!=='command,id,signed'||typeof value.id!=='string'||!credential)throw Error('INVALID_BODY');
      const result=await service.execute(origin,credential,value.id,value.command as MainnetAuthorityCommand,
        value.signed as Parameters<typeof service.execute>[4]);
      return Response.json({result},{headers});
    }catch{return Response.json({error:'AUTHORITY_UNAVAILABLE',retry:'WAIT_AND_RECONCILE'},{status:503,headers});}
  };
}
