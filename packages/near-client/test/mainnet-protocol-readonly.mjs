// Explicit live probe, excluded from offline unit tests. No signer or write API.
import {mainnetTransport} from '../dist/mainnet-network.js';
import {createMainnetWalletChain} from '../dist/index.js';
const profile={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'fastnear-readonly'};
const fetcher=(url,init)=>fetch(url,init);
const {rpc,finalBlock}=mainnetTransport(profile,fetcher);
const block=await finalBlock(),accountId='devkendinecrypto.near';
const account=await rpc('query',{request_type:'view_account',account_id:accountId,block_id:block.hash});
const keys=await rpc('query',{request_type:'view_access_key_list',account_id:accountId,block_id:block.hash});
if(account.block_hash!==block.hash || keys.block_hash!==block.hash)throw new Error('UNANCHORED_LIVE_READ');
const key=keys.keys.find(k=>k.access_key.permission==='FullAccess');
const snapshot=key?await createMainnetWalletChain(profile,fetcher).snapshot(accountId,key.public_key):null;
console.log(JSON.stringify({observedAt:new Date().toISOString(),kind:'READ_ONLY_CONFIGURED_RPC_EVIDENCE',
  profile,genesisValidated:true,accountId,block,amountYocto:account.amount,codeHash:account.code_hash,
  fullAccessKeyPresent:Boolean(key),snapshot,
  limitations:'No account creation, signing, transfer or candidate deployment. Public account/key reads do not prove wallet ownership.'},null,2));
