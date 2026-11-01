import { randomUUID } from 'node:crypto';
import { ApiErrorSchema, ERROR_CODES, AccountIdSchema, parseStrictJson, type ErrorCode } from '../../../packages/shared/dist/index.js';
import { DurableAuth, same } from './durable-auth.mts';
import { SessionEngine } from './sessions.mts';

export type CommerceHttpDependencies = { origin: string; auth: DurableAuth; engine: SessionEngine;
  // Composition boundary only. Production factory always leaves this false until
  // target-wallet capability acceptance; never controlled by HTTP/env/client data.
  authenticationAccepted: boolean };
const cookie = (name: string, token: string, age: number) => `${name}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
function cookies(request: Request): Map<string,string> {
  const raw=request.headers.get('cookie')??''; if(raw.length>4096) throw Error('INVALID_ARGUMENT');
  const result=new Map<string,string>();
  for(const part of raw.split(';')) {
    if(!part.trim()) continue; const [name,...rest]=part.trim().split('=');
    if(result.has(name)) throw Error('INVALID_ARGUMENT'); result.set(name,rest.join('='));
  } return result;
}
async function body(request: Request): Promise<Record<string,unknown>> {
  if(request.headers.get('content-type')?.split(';')[0] !== 'application/json' || !request.body) throw Error('INVALID_ARGUMENT');
  const reader=request.body.getReader(); let size=0; const chunks: Uint8Array[]=[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async()=>{ for(;;) { const chunk=await reader.read(); if(chunk.done) break;
        size+=chunk.value.length; if(size>8192) throw Error('INVALID_ARGUMENT'); chunks.push(chunk.value); }
        let value: unknown;
        try { value=parseStrictJson(Buffer.concat(chunks)); } catch { throw Error('INVALID_ARGUMENT'); }
        if(!value || typeof value!=='object' || Array.isArray(value)) throw Error('INVALID_ARGUMENT');
        return value as Record<string,unknown>;
      })(),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('INVALID_ARGUMENT')),2000);}),
    ]);
  } finally { clearTimeout(timer); void reader.cancel().catch(()=>undefined); }
}
function fields(value: Record<string,unknown>, names: string[]): void {
  if(Object.keys(value).sort().join()!==[...names].sort().join()) throw Error('INVALID_ARGUMENT');
}
export function createCommerceHandler(deps: CommerceHttpDependencies) {
  if(new URL(deps.origin).origin!==deps.origin || !deps.origin.startsWith('https://')) throw Error('INVALID_ARGUMENT');
  return async (request: Request, trustedClientId: string): Promise<Response> => {
    const headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
    const json=(data: unknown,status=200)=>Response.json(data,{status,headers});
    try {
      const url=new URL(request.url);
      if(url.origin!==deps.origin || url.search || url.hash || !/^[A-Za-z0-9:._-]{1,128}$/.test(trustedClientId)) throw Error('INVALID_ARGUMENT');
      if(request.headers.get('sec-fetch-site')==='cross-site') throw Error('CSRF_REJECTED');
      if(request.method!=='GET' && request.method!=='POST') throw Error('INVALID_ARGUMENT');
      if(request.method==='POST' && request.headers.get('origin')!==deps.origin) throw Error('CSRF_REJECTED');
      if(request.headers.has('origin') && request.headers.get('origin')!==deps.origin) throw Error('CSRF_REJECTED');
      deps.auth.rate(`ip:${trustedClientId}`);
      const path=url.pathname, jar=cookies(request), token=jar.get('__Host-taply-session')??'';
      if(path==='/api/v1/auth/challenges' && request.method==='POST') {
        if(!deps.authenticationAccepted) throw Error('VERIFICATION_UNAVAILABLE');
        const input=await body(request); fields(input,['accountId']); const account=AccountIdSchema.parse(input.accountId);
        const result=deps.auth.challenge(account,jar.get('__Host-taply-browser'));
        headers.append('Set-Cookie',cookie('__Host-taply-browser',result.browserToken,120)); return json(result.challenge);
      }
      if(path==='/api/v1/auth/verify' && request.method==='POST') {
        if(!deps.authenticationAccepted) throw Error('VERIFICATION_UNAVAILABLE');
        const input=await body(request); fields(input,['challengeId','signed']);
        if(typeof input.challengeId!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(input.challengeId)) throw Error('INVALID_ARGUMENT');
        const browser=jar.get('__Host-taply-browser'); if(!browser) throw Error('CSRF_REJECTED');
        const login=await deps.auth.verify(input.challengeId,browser,input.signed);
        headers.append('Set-Cookie',cookie('__Host-taply-session',login.token,900));
        headers.append('Set-Cookie',cookie('__Host-taply-browser','',0));
        return json({accountId:login.identity.accountId,csrfToken:login.csrf,network:'near-testnet'});
      }
      if(/^\/api\/v1\/merchants\/[^/]+$/.test(path) && request.method==='GET') {
        AccountIdSchema.parse(path.split('/').at(-1)); throw Error('MERCHANT_NOT_FOUND');
      }
      const session=deps.auth.session(token);
      deps.auth.rate(`account:${session.identity.accountId}`);
      if(request.method==='POST' && !same(request.headers.get('x-csrf-token')??'',session.csrf)) throw Error('CSRF_REJECTED');
      if(path==='/api/v1/auth/me' && request.method==='GET') return json({accountId:session.identity.accountId,csrfToken:session.csrf,network:'near-testnet'});
      if(path==='/api/v1/auth/logout' && request.method==='POST') {
        const input=await body(request); fields(input,[]); deps.auth.logout(token);
        headers.append('Set-Cookie',cookie('__Host-taply-session','',0)); return json({loggedOut:true});
      }
      if(path==='/api/v1/sessions' && request.method==='POST') {
        const input=await body(request); fields(input,[]);
        return json(await deps.engine.create(token,request.headers.get('idempotency-key')??''));
      }
      const match=path.match(/^\/api\/v1\/sessions\/([^/]+)(?:\/(bind|join|review|close|presence|events))?$/);
      if(!match) throw Error('VERIFICATION_UNAVAILABLE'); const [,id,action]=match;
      if(request.method==='GET' && !action) return json(await deps.engine.read(token,id));
      if(request.method==='GET' && action==='events') return json(await deps.engine.events(token,id,request.headers.get('last-event-id')??'0'));
      if(request.method==='POST') {
        const input=await body(request), key=request.headers.get('idempotency-key')??'';
        if(action==='bind') return json(await deps.engine.bind(token,id,key,input));
        if(action==='join') return json(await deps.engine.join(token,id,key,input));
        if(action==='review') return json(await deps.engine.review(token,id,key,input));
        if(action==='close') { fields(input,[]); return json(await deps.engine.close(token,id)); }
        if(action==='presence') { fields(input,['connected']); if(typeof input.connected!=='boolean') throw Error('INVALID_ARGUMENT'); return json(await deps.engine.presence(token,id,input.connected)); }
      }
      throw Error('VERIFICATION_UNAVAILABLE');
    } catch(error) {
      const message=error instanceof Error?error.message:'';
      const code: ErrorCode = (ERROR_CODES as readonly string[]).includes(message)?message as ErrorCode:
        error instanceof Error && error.name==='ZodError'?'INVALID_ARGUMENT':'VERIFICATION_UNAVAILABLE';
      const status=code==='RATE_LIMITED'?429:code.startsWith('AUTH_')?401:code==='CSRF_REJECTED'||code==='NOT_AUTHORIZED'?403:
        code==='VERIFICATION_UNAVAILABLE'?503:code.endsWith('NOT_FOUND')?404:400;
      return json(ApiErrorSchema.parse({schemaVersion:'taply.api.v1',error:{code,messageKey:`errors.${code}`,requestId:randomUUID(),retryAction:'NONE',retryAfterMs:null,details:{}}}),status);
    }
  };
}
