import {test} from 'node:test';
import {baseEncode} from 'near-api-js';
import assert from 'node:assert/strict';
import {canonicalJson,MAINNET_USDC} from '@taply/shared';
import {createMainnetOperationPlanner,createMainnetSwapReader,quoteMainnetSwap,mainnetSimplePoolOut,mainnetMinAmountOut,mainnetPriceImpactBps,
  mainnetSwapMsg,verifyMainnetSwapStep,mainnetTokenTransferAmount,MAINNET_GENESIS_HASH,MAINNET_REF_EXCHANGE,MAINNET_REF_CODE_HASH,
  MAINNET_WRAP,MAINNET_WRAP_CODE_HASH,MAINNET_SWAP_LIMITS} from '../dist/index.js';

// Synthetic Mainnet RPC. Reserves are the real pool 4512 values read on 2026-11-23 (block 225830071).
const H=n=>'1'.repeat(31)+n,usdcCode=H(9),block=H(2),key='ed25519:11111111111111111111111111111111';
const network={network:'near-mainnet',rpcUrl:'https://rpc.mainnet.fastnear.com',rpcProviderId:'synthetic'};
const profiles={network,usdcCodeHash:usdcCode};
const ME='alice.near',SWAP_ID='c'.repeat(64);
const snapshot={network:'near-mainnet',accountId:ME,publicKey:key,nonce:'7',blockHash:block,blockHeight:'20000000',blockTimestampNs:'1793520000000000001',
  amountYocto:'5000000000000000000000000',storageUsageBytes:'456',storageByteCostYocto:'10000000000000000000',gasPriceYocto:'100000000'};
const RES={usdc:'879942263815',wnear:'292817259658116838033928023044'};
const codeOf=id=>id===MAINNET_REF_EXCHANGE?MAINNET_REF_CODE_HASH:id===MAINNET_WRAP?MAINNET_WRAP_CODE_HASH:id===MAINNET_USDC?usdcCode:H(5);
function fetcher(o={}){return async(_,init)=>{const r=JSON.parse(init.body),p=r.params;let result;
  if(r.method==='status')result={chain_id:'mainnet',sync_info:{syncing:false}};
  else if(r.method==='block')result={header:{hash:p.block_id===9820210?MAINNET_GENESIS_HASH:block,height:p.block_id===9820210?9820210:20000000,timestamp_nanosec:snapshot.blockTimestampNs}};
  else if(r.method==='EXPERIMENTAL_tx_status')result=o.tx;
  else if(r.method==='gas_price')result={gas_price:snapshot.gasPriceYocto};
  else if(r.method==='EXPERIMENTAL_protocol_config')result={runtime_config:{storage_amount_per_byte:snapshot.storageByteCostYocto}};
  else if(p.request_type==='view_account')result={amount:snapshot.amountYocto,locked:'0',storage_usage:456,code_hash:o.codes?.[p.account_id]??codeOf(p.account_id),block_hash:block,block_height:20000000};
  else{
    const a=JSON.parse(Buffer.from(p.args_base64,'base64').toString());let value;
    if(p.method_name==='get_pool')value=o.pool??{pool_kind:'SIMPLE_POOL',token_account_ids:[MAINNET_USDC,MAINNET_WRAP],amounts:[RES.usdc,RES.wnear],total_fee:30,shares_total_supply:'1',amp:0};
    else if(p.method_name==='get_return'){const inUsdc=a.token_in===MAINNET_USDC,[ru,rw]=o.pool?.amounts??[RES.usdc,RES.wnear];
      value=o.getReturn??mainnetSimplePoolOut(BigInt(a.amount_in),BigInt(inUsdc?ru:rw),BigInt(inUsdc?rw:ru),30).toString();}
    else if(p.method_name==='ft_balance_of')value=o.balances?.[a.account_id]??'1000000000000000000000000000';
    else if(p.method_name==='storage_balance_of')value=(o.unregistered??[]).includes(`${p.account_id}:${a.account_id}`)?null:{total:'1250000000000000000000',available:'0'};
    else if(p.method_name==='storage_balance_bounds')value={min:o.storageMin??'1250000000000000000000',max:'1250000000000000000000'};
    else if(p.method_name==='ft_metadata')value={spec:'ft-1.0.0',name:'x',symbol:'x',decimals:o.decimals?.[p.account_id]??(p.account_id===MAINNET_USDC?6:24)};
    else throw Error('unexpected '+p.method_name);
    result={result:[...Buffer.from(JSON.stringify(value))],logs:[],block_hash:block,block_height:20000000};
  }
  return Response.json({jsonrpc:'2.0',id:r.id,result});};}
const plan=(op,o)=>createMainnetOperationPlanner(profiles,fetcher(o)).prepare({swapId:SWAP_ID,...op},snapshot);
const expectedOut=(tin,amt)=>mainnetSimplePoolOut(BigInt(amt),BigInt(tin===MAINNET_USDC?RES.usdc:RES.wnear),BigInt(tin===MAINNET_USDC?RES.wnear:RES.usdc),30);
const code=async(p,c)=>{await assert.rejects(p,e=>{assert.equal(e.message,c);return true;});};

test('math: exact-input output matches the exchange formula; min received and price impact are integer and separate',()=>{
  // 0.1 NEAR at the real reserves = 0.299607 USDC (observed get_return at block 225830071).
  assert.equal(expectedOut(MAINNET_WRAP,'100000000000000000000000'),299607n);
  assert.equal(expectedOut(MAINNET_USDC,'1000000'),331770036637078063033982n);
  assert.equal(mainnetMinAmountOut(299607n,50),298108n);
  assert.equal(mainnetMinAmountOut(10n,500),9n);
  assert.throws(()=>mainnetMinAmountOut(1n,50),/SWAP_MIN_OUT_TOO_LOW/);
  for(const bad of [0,501,1.5,-1])assert.throws(()=>mainnetMinAmountOut(1000n,bad),/SWAP_INVALID_AMOUNT/);
  assert.equal(mainnetPriceImpactBps(1n,1000000n),1);
  assert.equal(mainnetPriceImpactBps(1000000n,1000000n),5000);
});

test('policy: NEAR→USDC is register (if needed) + wrap + one ft_transfer_call with skip_unwrap_near and the exact min',async()=>{
  const reg=await plan({kind:'swapRegister',token:MAINNET_WRAP},{unregistered:[`${MAINNET_WRAP}:${ME}`]});
  assert.equal(reg.receiverId,MAINNET_WRAP);assert.equal(reg.action.methodName,'storage_deposit');assert.equal(reg.action.depositYocto,'1250000000000000000000');
  assert.equal(reg.action.argsJson,canonicalJson({account_id:ME,registration_only:true}));
  const wrap=await plan({kind:'swapWrap',amountYocto:'100000000000000000000000'});
  assert.deepEqual([wrap.receiverId,wrap.action.methodName,wrap.action.depositYocto,wrap.action.argsJson],[MAINNET_WRAP,'near_deposit','100000000000000000000000','{}']);
  const min=mainnetMinAmountOut(299607n,50).toString();
  const swap=await plan({kind:'swapExact',tokenIn:MAINNET_WRAP,tokenOut:MAINNET_USDC,amountIn:'100000000000000000000000',minAmountOut:min});
  assert.equal(swap.receiverId,MAINNET_WRAP);assert.equal(swap.action.methodName,'ft_transfer_call');assert.equal(swap.action.depositYocto,'1');
  const args=JSON.parse(swap.action.argsJson);
  assert.equal(args.receiver_id,MAINNET_REF_EXCHANGE);
  assert.deepEqual(JSON.parse(args.msg),{actions:[{pool_id:4512,token_in:MAINNET_WRAP,token_out:MAINNET_USDC,amount_in:'100000000000000000000000',min_amount_out:min}],skip_unwrap_near:true});
  // Each step is its own operation (distinct hash); the swap id is part of the hash.
  assert.notEqual(wrap.operationHash,swap.operationHash);
  const other=await createMainnetOperationPlanner(profiles,fetcher()).prepare({kind:'swapWrap',swapId:'d'.repeat(64),amountYocto:'100000000000000000000000'},snapshot);
  assert.notEqual(other.operationHash,wrap.operationHash);
});

test('policy: USDC→NEAR swaps to wNEAR, then a separate near_withdraw for an amount the account holds',async()=>{
  const min=mainnetMinAmountOut(expectedOut(MAINNET_USDC,'1000000'),50).toString();
  const swap=await plan({kind:'swapExact',tokenIn:MAINNET_USDC,tokenOut:MAINNET_WRAP,amountIn:'1000000',minAmountOut:min});
  assert.equal(swap.receiverId,MAINNET_USDC);assert.equal(JSON.parse(JSON.parse(swap.action.argsJson).msg).skip_unwrap_near,true);
  const unwrap=await plan({kind:'swapUnwrap',amountYocto:min},{balances:{[ME]:min}});
  assert.deepEqual([unwrap.receiverId,unwrap.action.methodName,unwrap.action.depositYocto,unwrap.action.argsJson],[MAINNET_WRAP,'near_withdraw','1',canonicalJson({amount:min})]);
  await code(plan({kind:'swapUnwrap',amountYocto:(BigInt(min)+1n).toString()},{balances:{[ME]:min}}),'SWAP_INSUFFICIENT_TOKEN');
});

test('policy refuses tampering: min 0/low/above output, other pool/fee/code, unlisted tokens, same pair, caps, missing registrations',async()=>{
  const amt='100000000000000000000000',exp=expectedOut(MAINNET_WRAP,amt);
  const swap=(o={},extra={})=>plan({kind:'swapExact',tokenIn:MAINNET_WRAP,tokenOut:MAINNET_USDC,amountIn:amt,minAmountOut:mainnetMinAmountOut(exp,50).toString(),...extra},o);
  await code(swap({},{minAmountOut:'0'}),'SWAP_INVALID_AMOUNT');
  await code(swap({},{minAmountOut:'1'}),'SWAP_MIN_OUT_TOO_LOW');
  await code(swap({},{minAmountOut:(exp*9499n/10000n).toString()}),'SWAP_MIN_OUT_TOO_LOW');
  await code(swap({},{minAmountOut:(exp+1n).toString()}),'SWAP_QUOTE_MOVED');
  await code(swap({pool:{pool_kind:'SIMPLE_POOL',token_account_ids:[MAINNET_USDC,MAINNET_WRAP],amounts:[RES.usdc,RES.wnear],total_fee:31}}),'SWAP_POOL_MISMATCH');
  await code(swap({pool:{pool_kind:'STABLE_SWAP',token_account_ids:[MAINNET_USDC,MAINNET_WRAP],amounts:[RES.usdc,RES.wnear],total_fee:30}}),'SWAP_POOL_MISMATCH');
  await code(swap({pool:{pool_kind:'SIMPLE_POOL',token_account_ids:['evil.near',MAINNET_WRAP],amounts:[RES.usdc,RES.wnear],total_fee:30}}),'SWAP_POOL_MISMATCH');
  await code(swap({codes:{[MAINNET_REF_EXCHANGE]:H(7)}}),'SWAP_CODE_PIN_MISMATCH');
  await code(swap({codes:{[MAINNET_WRAP]:H(7)}}),'SWAP_CODE_PIN_MISMATCH');
  await code(swap({getReturn:(exp-1n).toString()}),'SWAP_MATH_MISMATCH');
  await code(swap({},{tokenIn:'usdt.tether-token.near'}),'SWAP_TOKEN_NOT_ALLOWED');
  await code(swap({},{tokenOut:MAINNET_WRAP}),'SWAP_SAME_TOKEN');
  await code(swap({},{amountIn:(MAINNET_SWAP_LIMITS.maxInput[MAINNET_WRAP]+1n).toString()}),'SWAP_CAP_EXCEEDED');
  await code(swap({unregistered:[`${MAINNET_USDC}:${ME}`]}),'SWAP_NOT_REGISTERED');
  await code(swap({balances:{[ME]:'1'}}),'SWAP_INSUFFICIENT_TOKEN');
  await code(plan({kind:'swapWrap',amountYocto:amt},{unregistered:[`${MAINNET_WRAP}:${ME}`]}),'SWAP_NOT_REGISTERED');
  await code(plan({kind:'swapRegister',token:MAINNET_WRAP}),'SWAP_ALREADY_REGISTERED');
  await code(plan({kind:'swapRegister',token:MAINNET_USDC},{unregistered:[`${MAINNET_USDC}:${ME}`],storageMin:'20000000000000000000000'}),'SWAP_STORAGE_OUT_OF_BOUNDS');
  await code(plan({kind:'swapRegister',token:'evil.near'}),'SWAP_TOKEN_NOT_ALLOWED');
  // Without the USDC code pin nothing is planned.
  await assert.rejects(createMainnetOperationPlanner({network},fetcher()).prepare({kind:'swapWrap',swapId:SWAP_ID,amountYocto:amt},snapshot),/TOKEN_CODE_PIN_REQUIRED/);
  // Price impact over the policy limit (thin pool: 10 NEAR in a 100 NEAR pool).
  const thin={pool_kind:'SIMPLE_POOL',token_account_ids:[MAINNET_USDC,MAINNET_WRAP],amounts:['300000000','100000000000000000000000000'],total_fee:30};
  const tin=(10n**25n).toString(),texp=mainnetSimplePoolOut(10n**25n,10n**26n,300000000n,30);
  await code(plan({kind:'swapExact',tokenIn:MAINNET_WRAP,tokenOut:MAINNET_USDC,amountIn:tin,minAmountOut:mainnetMinAmountOut(texp,50).toString()},{pool:thin}),'SWAP_PRICE_IMPACT_TOO_HIGH');
});

test('the native NEAR budget keeps gas: a wrap that would leave less than the gas+storage reserve is refused',async()=>{
  await assert.rejects(plan({kind:'swapWrap',amountYocto:snapshot.amountYocto}),/INSUFFICIENT_AVAILABLE_BALANCE/);
});

test('reader: one final block, pins, decimals re-checked, account balances and registrations',async()=>{
  const s=await createMainnetSwapReader(network,usdcCode,fetcher({unregistered:[`${MAINNET_WRAP}:${ME}`]})).read(ME);
  assert.equal(s.blockHash,block);assert.equal(s.account.registered[MAINNET_WRAP],false);assert.equal(s.account.registered[MAINNET_USDC],true);
  const q=await quoteMainnetSwap(s.chain,s.pool,MAINNET_WRAP,MAINNET_USDC,'100000000000000000000000');
  assert.equal(q.expectedOut,'299607');assert.equal(q.poolFeeIn,'300000000000000000000');
  await assert.rejects(createMainnetSwapReader(network,usdcCode,fetcher({decimals:{[MAINNET_USDC]:18}})).read(null),/SWAP_POOL_MISMATCH/);
});

// --- FINAL receipt verification, modelled on real Mainnet receipts (tx 5hqTTBG2…, AR2hxHrF…, 2026-11-23) ---
const TX=baseEncode(new Uint8Array(32).fill(3)),R=n=>baseEncode(new Uint8Array(32).fill(40+n)),b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64');
const out=(id,executor,status,logs=[],ids=[])=>({id,block_hash:block,outcome:{executor_id:executor,status,logs,receipt_ids:ids,gas_burnt:1,tokens_burnt:'0'}});
function swapTx({tokenIn,tokenOut,amountIn,min,used,delivered,logsExtra=[],outReceipt=true}){
  const msg=mainnetSwapMsg(tokenIn,tokenOut,amountIn,min);
  const transferLog=tokenOut===MAINNET_WRAP?`Transfer ${delivered} from ${MAINNET_REF_EXCHANGE} to ${ME}`:`EVENT_JSON:${JSON.stringify({standard:'nep141',version:'1.0.0',event:'ft_transfer',data:[{old_owner_id:MAINNET_REF_EXCHANGE,new_owner_id:ME,amount:String(delivered)}]})}`;
  return {final_execution_status:'FINAL',status:{SuccessValue:b64(JSON.stringify(String(used)))},
    transaction:{hash:TX,signer_id:ME,receiver_id:tokenIn,actions:[{FunctionCall:{method_name:'ft_transfer_call',args:b64({receiver_id:MAINNET_REF_EXCHANGE,amount:amountIn,msg}),gas:150000000000000,deposit:'1'}}]},
    transaction_outcome:out(TX,ME,{SuccessReceiptId:R(1)},[],[R(1)]),
    receipts_outcome:[out(R(1),tokenIn,{SuccessReceiptId:R(2)},[],[R(2),R(5)]),
      out(R(2),MAINNET_REF_EXCHANGE,used==='0'?{Failure:{ActionError:{}}}:{SuccessValue:b64('"0"')},used==='0'?[]:[`Swapped ${amountIn} ${tokenIn} for ${delivered} ${tokenOut}`,...logsExtra],outReceipt?[R(3)]:[]),
      ...(outReceipt?[out(R(3),tokenOut,{SuccessValue:''},used==='0'?[]:[transferLog])]:[]),
      out(R(5),tokenIn,{SuccessValue:b64(JSON.stringify(String(used)))})]};
}
const verify=(tx,operation)=>verifyMainnetSwapStep(network,{transactionHash:TX,accountId:ME,operation},fetcher({tx}));

test('verify: SWAPPED needs used = input, an Ref swap log and a successful transfer to the account of at least min',async()=>{
  const op={kind:'swapExact',swapId:SWAP_ID,tokenIn:MAINNET_WRAP,tokenOut:MAINNET_USDC,amountIn:'100000000000000000000000',minAmountOut:'298108'};
  assert.deepEqual(await verify(swapTx({tokenIn:op.tokenIn,tokenOut:op.tokenOut,amountIn:op.amountIn,min:op.minAmountOut,used:op.amountIn,delivered:'299600'}),op),
    {kind:'SWAPPED',transactionHash:TX,amountIn:op.amountIn,amountOut:'299600',tokenIn:MAINNET_WRAP,tokenOut:MAINNET_USDC,blockHash:block});
  // wNEAR output uses wrap.near's plain-text transfer log; it is reported as wNEAR, never as NEAR.
  const back={kind:'swapExact',swapId:SWAP_ID,tokenIn:MAINNET_USDC,tokenOut:MAINNET_WRAP,amountIn:'1000000',minAmountOut:'330000000000000000000000'};
  const r=await verify(swapTx({tokenIn:back.tokenIn,tokenOut:back.tokenOut,amountIn:back.amountIn,min:back.minAmountOut,used:back.amountIn,delivered:'331000000000000000000000'}),back);
  assert.equal(r.kind,'SWAPPED');assert.equal(r.tokenOut,MAINNET_WRAP);
  // Below min / log disagreement / wrong msg → not verified.
  assert.equal((await verify(swapTx({tokenIn:op.tokenIn,tokenOut:op.tokenOut,amountIn:op.amountIn,min:op.minAmountOut,used:op.amountIn,delivered:'1'}),op)).kind,'NOT_VERIFIED');
  assert.equal((await verify(swapTx({tokenIn:op.tokenIn,tokenOut:op.tokenOut,amountIn:op.amountIn,min:'1',used:op.amountIn,delivered:'299600'}),op)).kind,'NOT_VERIFIED');
});

test('verify: a slippage failure is REFUNDED (tx SuccessValue "0"), never success; lostfound or no transfer is OUTPUT_NOT_DELIVERED',async()=>{
  const op={kind:'swapExact',swapId:SWAP_ID,tokenIn:MAINNET_USDC,tokenOut:MAINNET_WRAP,amountIn:'1000000',minAmountOut:'330000000000000000000000'};
  const base={tokenIn:op.tokenIn,tokenOut:op.tokenOut,amountIn:op.amountIn,min:op.minAmountOut};
  assert.deepEqual(await verify(swapTx({...base,used:'0',delivered:'0'}),op),{kind:'REFUNDED',transactionHash:TX,refunded:'1000000',tokenIn:MAINNET_USDC});
  assert.deepEqual(await verify(swapTx({...base,used:op.amountIn,delivered:'331000000000000000000000',logsExtra:['Account alice.near is not registered. Depositing to owner or user lostfound account.'],outReceipt:false}),op),
    {kind:'OUTPUT_NOT_DELIVERED',transactionHash:TX,amountIn:'1000000',lostfound:true});
  assert.equal((await verify(swapTx({...base,used:'500000',delivered:'1'}),op)).kind,'NOT_VERIFIED');
  // used "0" but an output transfer / Swapped log in the same graph: contradictory, never a refund or a success.
  const contradictory=swapTx({...base,used:op.amountIn,delivered:'331000000000000000000000'});
  contradictory.status={SuccessValue:b64(JSON.stringify('0'))};
  assert.deepEqual(await verify(contradictory,op),{kind:'NOT_VERIFIED',reason:'MISMATCH'});
  assert.deepEqual(await verifyMainnetSwapStep(network,{transactionHash:TX,accountId:ME,operation:op},async()=>{throw Error('down');}),{kind:'NOT_VERIFIED',reason:'UNAVAILABLE'});
});

test('verify: wrap needs wrap.near\'s deposit log; unwrap needs the native Transfer receipt from wrap.near',async()=>{
  const amount='100000000000000000000000';
  const wrapTx={final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:TX,signer_id:ME,receiver_id:MAINNET_WRAP,actions:[{FunctionCall:{method_name:'near_deposit',args:b64({}),gas:1,deposit:amount}}]},
    transaction_outcome:out(TX,ME,{SuccessReceiptId:R(1)},[],[R(1)]),receipts_outcome:[out(R(1),MAINNET_WRAP,{SuccessValue:''},[`Deposit ${amount} NEAR to ${ME}`])]};
  assert.deepEqual(await verify(wrapTx,{kind:'swapWrap',swapId:SWAP_ID,amountYocto:amount}),{kind:'WRAPPED',transactionHash:TX,amount});
  assert.equal((await verify({...wrapTx,receipts_outcome:[out(R(1),MAINNET_WRAP,{SuccessValue:''},[])]},{kind:'swapWrap',swapId:SWAP_ID,amountYocto:amount})).kind,'NOT_VERIFIED');
  const unwrapTx={final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:TX,signer_id:ME,receiver_id:MAINNET_WRAP,actions:[{FunctionCall:{method_name:'near_withdraw',args:b64({amount}),gas:1,deposit:'1'}}]},
    transaction_outcome:out(TX,ME,{SuccessReceiptId:R(1)},[],[R(1)]),receipts_outcome:[out(R(1),MAINNET_WRAP,{SuccessValue:''},[],[R(2)]),out(R(2),ME,{SuccessValue:''})],
    receipts:[{receipt_id:R(2),predecessor_id:MAINNET_WRAP,receiver_id:ME,receipt:{Action:{actions:[{Transfer:{deposit:amount}}]}}}]};
  assert.deepEqual(await verify(unwrapTx,{kind:'swapUnwrap',swapId:SWAP_ID,amountYocto:amount}),{kind:'UNWRAPPED',transactionHash:TX,amount});
  assert.equal((await verify({...unwrapTx,receipts:[]},{kind:'swapUnwrap',swapId:SWAP_ID,amountYocto:amount})).kind,'NOT_VERIFIED');
  assert.equal((await verify({...unwrapTx,final_execution_status:'EXECUTED'},{kind:'swapUnwrap',swapId:SWAP_ID,amountYocto:amount})).kind,'NOT_VERIFIED');
  assert.equal((await verify({...unwrapTx,status:{Failure:{}}},{kind:'swapUnwrap',swapId:SWAP_ID,amountYocto:amount})).kind,'FAILED');
});

test('token transfer log parser accepts only exact from/to pairs',()=>{
  assert.equal(mainnetTokenTransferAmount([`Transfer 5 from ${MAINNET_REF_EXCHANGE} to ${ME}`,`Transfer 7 from ${MAINNET_REF_EXCHANGE} to bob.near`,'Transfer x from a to b'],MAINNET_REF_EXCHANGE,ME),5n);
  assert.equal(mainnetTokenTransferAmount([`EVENT_JSON:{"standard":"nep171","event":"ft_transfer","data":[{"old_owner_id":"${MAINNET_REF_EXCHANGE}","new_owner_id":"${ME}","amount":"9"}]}`],MAINNET_REF_EXCHANGE,ME),0n);
});
