// TEST ONLY: real local sandbox receipts, with an explicit genesis adapter.
// No Mainnet evidence and no fallback in production transport.
import {writeFileSync} from 'node:fs';
import {MAINNET_USDC} from '@taply/shared';
import {verifyMainnetSettlement,verifyMainnetGiftSettlement,MAINNET_GENESIS_HASH,MAINNET_GENESIS_HEIGHT} from '../dist/index.js';
const [url,contract,id,hash,signer,output,optionsJson]=process.argv.slice(2);
const options=optionsJson?JSON.parse(optionsJson):{kind:'instant'};
const endpoint=new URL(url);
if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.protocol!=='http:')throw Error('LOCAL_SANDBOX_ONLY');
const evidence=[];
async function raw(method,params,id='sandbox'){
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
  const text=await response.text();evidence.push({method,params,rawResponse:text});return text;
}
const account=JSON.parse(await raw('query',{request_type:'view_account',account_id:contract,finality:'final'})).result;
const token=options.kind==='gift'?null:JSON.parse(await raw('query',{request_type:'view_account',account_id:MAINNET_USDC,finality:'final'})).result;
const profile={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'LOCAL_SANDBOX_GENESIS_ADAPTER',contract:{accountId:contract,expectedCodeHash:account.code_hash}};
if(options.kind==='gift'){
  const config=JSON.parse(Buffer.from(JSON.parse(await raw('query',{request_type:'call_function',account_id:contract,method_name:'get_config',args_base64:'e30=',finality:'final'})).result.result).toString());
  Object.assign(profile.contract,{minAmountYocto:config.minAmountYocto,maxAmountYocto:config.maxAmountYocto,giftFeeYocto:config.giftFeeYocto});
}
const adapter=async(_,init)=>{
  const q=JSON.parse(init.body);
  if(q.method==='status')return Response.json({jsonrpc:'2.0',id:q.id,result:{chain_id:'mainnet',sync_info:{syncing:false}}});
  if(q.method==='block'&&q.params.block_id===MAINNET_GENESIS_HEIGHT)return Response.json({jsonrpc:'2.0',id:q.id,result:{header:{hash:MAINNET_GENESIS_HASH,height:MAINNET_GENESIS_HEIGHT,timestamp_nanosec:'0'}}});
  return new Response(await raw(q.method,q.params,q.id),{headers:{'content-type':'application/json'}});
};
const reference={id,funding:{transactionHash:hash,signerAccountId:signer},operations:options.operations??[{transactionHash:hash,signerAccountId:signer}],...(token?{usdcCodeHash:token.code_hash}:{})};
const result=options.kind==='gift'?await verifyMainnetGiftSettlement(profile,{giftId:id,operations:reference.operations},adapter):await verifyMainnetSettlement({kind:options.kind,profile},reference,adapter);
writeFileSync(output,JSON.stringify({kind:'LOCAL_SANDBOX_WITH_EXPLICIT_GENESIS_ADAPTER_NOT_MAINNET',standardTestTokenNotLiveUsdc:true,profile,reference,result,evidence},null,2));
if(!['VERIFIED_SETTLEMENT','VERIFIED_GIFT_SETTLEMENT'].includes(result.kind))throw Error(`Sandbox receipt verification failed: ${JSON.stringify(result)}; evidence: ${output}`);
console.log(`Independent local receipt proof: ${result.assetId} ${result.status}`);
