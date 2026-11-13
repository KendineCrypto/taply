import {canonicalJson} from '../../../packages/shared/dist/index.js';
import {createMainnetTransactionCoordinator,createMainnetOperationPlanner,createMainnetWalletChain,
  type MainnetGlobalAttemptStore,type MainnetSigningProfiles,type MainnetWalletAuthority} from '../../../packages/near-client/dist/index.js';

/** Server-side semantic service, NOT an HTTP authentication implementation.
 * Principal must come from reviewed account/device authentication, never JSON
 * supplied by a browser. No seeds, private keys or signing are accepted here.
 * The caller must provision durable no-eviction/rollback-protected authority.
 * Keep HTTP exposure disabled pending that separate security integration. */
export function createMainnetWalletAuthority(input:{principal:{accountId:string;publicKey:string;deviceId:string};
  profiles:MainnetSigningProfiles;store:MainnetGlobalAttemptStore},fetcher:typeof fetch=globalThis.fetch):MainnetWalletAuthority{
  const principal=Object.freeze({...input.principal}),profiles=structuredClone(input.profiles),store=input.store;
  const coordinator=createMainnetTransactionCoordinator({store,deviceId:principal.deviceId,profile:profiles.network},fetcher);
  const chain=createMainnetWalletChain(profiles.network,fetcher),planner=createMainnetOperationPlanner(profiles,fetcher);
  const scoped=(accountId:string)=>{if(accountId!==principal.accountId)throw Error('UNAUTHORIZED_ACCOUNT');};
  return Object.freeze({
    async read(accountId){scoped(accountId);return coordinator.read(accountId);},
    async reserve(operationHash,expectation,operation){
      scoped(expectation.accountId);if(expectation.publicKey!==principal.publicKey)throw Error('UNAUTHORIZED_KEY');
      const s=await chain.snapshot(principal.accountId,principal.publicKey);if(!s)throw Error('ACCOUNT_NOT_ACTIVATED');
      const plan=await planner.prepare(operation,s);
      if(plan.operationHash!==operationHash||canonicalJson(plan.action)!==canonicalJson(expectation.action)||plan.receiverId!==expectation.receiverId||
        s.nonce!==expectation.minimumNonce||(expectation.nonce!==null&&expectation.nonce!==(BigInt(s.nonce)+1n).toString())||
        BigInt(s.blockHeight)<BigInt(expectation.anchorHeight)||(s.blockHeight===expectation.anchorHeight&&s.blockHash!==expectation.anchorHash))throw Error('REVIEW_CHANGED');
      return coordinator.reserve(operationHash,expectation);
    },
    async handoff(attempt,hash){scoped(attempt.expectation.accountId);return coordinator.handoff(attempt,hash);},
    async uncertain(attempt,hash){scoped(attempt.expectation.accountId);return coordinator.uncertain(attempt,hash);},
    async reconcile(accountId,hashHint){scoped(accountId);return coordinator.reconcile(accountId,hashHint);},
  });
}
