import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, GENESIS } from './deploy-dry-run.mjs';
const options = { rpcUrl: 'https://rpc.mainnet.near.org', accountId: 'devkendinecrypto.near', wasm: Buffer.from('0061736d01000000', 'hex') };
function rpc(fault) { return async (method, params) => {
  if (method === 'status') return { chain_id: fault === 'network' ? 'testnet' : 'mainnet', sync_info: { syncing: false } };
  if (method === 'block') {
    if (params.block_id !== undefined) assert.equal(params.block_id, 9820210);
    return { header: { hash: fault === 'genesis' ? 'bad' : GENESIS } };
  }
  if (method === 'gas_price') return { gas_price: '100000000' };
  if (method === 'EXPERIMENTAL_protocol_config') return { runtime_config: { storage_amount_per_byte: '10000000000000000000' } };
  if (params.request_type === 'view_account') return { amount: '6000000000000000000000000', storage_usage: 100,
    code_hash: fault === 'existing' ? 'existing-code' : '11111111111111111111111111111111' };
  const value = params.method_name === 'storage_balance_of' ? null : { min: '1250000000000000000000', max: '1250000000000000000000' };
  return { result: [...Buffer.from(JSON.stringify(value))] };
}; }
test('dry-run prints atomic deploy+init and USDC registration, never keys or transfers', async () => {
  const report = await plan(options, rpc()); assert.equal(report.mode, 'DRY_RUN_ONLY');
  assert.deepEqual(report.transactions[0].actions.map(a => a.type), ['DeployContract', 'FunctionCall']);
  assert.equal(report.transactions[0].actions[1].methodName, 'new'); assert.equal(report.transactions[1].actions[0].methodName, 'storage_deposit');
  assert.equal(JSON.stringify(report.transactions).includes('DeleteKey'), false); assert.equal(report.readiness.startsWith('NO_GO'), true);
});
for (const fault of ['network', 'genesis', 'existing']) test(`planner refuses ${fault}`, async () => {
  await assert.rejects(plan(options, rpc(fault)));
});
test('planner refuses owner account and wrong RPC before any read', async () => {
  const forbidden = () => { throw new Error('should not reach RPC'); };
  await assert.rejects(plan({ ...options, accountId: 'kendinecrypto.near' }, forbidden), /WRONG_DESTINATION/);
  await assert.rejects(plan({ ...options, rpcUrl: 'https://rpc.testnet.near.org' }, forbidden), /UNAPPROVED_MAINNET_RPC/);
});
