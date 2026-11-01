import { DurableStore, SqliteSessionPersistence } from './storage.mts';
import { DurableAuth, emptyAuth } from './durable-auth.mts';
import { createNep413Verifier, finalizedTestnetKeys } from './nep413.mts';
import { createPilotReader, PILOT_CONTRACT } from './pilot-reader.mts';
import { SessionEngine } from './sessions.mts';
import { createCommerceHandler } from './commerce-http.mts';

/** Production composition: no listener/deployment, no capability override. */
export function createCommerceService(path: string, encryptionKey: Uint8Array, origin: string, initialize = false) {
  const authStore=new DurableStore(path,encryptionKey,'auth',emptyAuth,initialize);
  const sessions=new SqliteSessionPersistence(path,encryptionKey,initialize);
  const auth=new DurableAuth(authStore,origin,PILOT_CONTRACT,createNep413Verifier(origin,PILOT_CONTRACT,finalizedTestnetKeys()));
  const engine=new SessionEngine(sessions,{contractId:PILOT_CONTRACT,
    authenticate:async credential=>auth.session(typeof credential==='string'?credential:'').identity,
    readCanonicalRequest:createPilotReader().readCanonicalRequest});
  const handle=createCommerceHandler({origin,auth,engine,authenticationAccepted:false});
  return {handle,cleanup:()=>{auth.cleanup();return engine.cleanup();},close:()=>{authStore.close();sessions.close();}};
}
