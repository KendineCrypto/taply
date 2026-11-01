import { describe, expect, it } from 'vitest';
import { ContractRequestSchema, VerifiedReceiptSchema } from '@/lib/protocol';
import paidRestricted from '@/test/fixtures/sandbox/paid-restricted.json';
import paidAfterRetry from '@/test/fixtures/sandbox/paid-after-retry.json';
import inFlight from '@/test/fixtures/sandbox/in-flight.json';
import failed from '@/test/fixtures/sandbox/failed.json';
import open from '@/test/fixtures/sandbox/open.json';
import { VerifierRpcError } from '../rpc';
import { verifyInstantReceipt } from '../instant-receipt';
import type { VerificationResult } from '../instant-receipt';
import {
  APPROVED_CODE_HASH,
  actionOf,
  buildPaidChain,
  encodeArgs,
  hashOf,
  outcomes,
  receipts,
  txJson,
} from './fake-chain';

type Json = Record<string, unknown>;

const PAID = ContractRequestSchema.parse(paidRestricted);
const RETRIED = ContractRequestSchema.parse(paidAfterRetry);

function reason(result: VerificationResult): string {
  return result.kind === 'verified' ? 'verified' : result.reason;
}

/** Builds the happy chain, applies one mutation, verifies. */
async function mutated(mutate: (ctx: ReturnType<typeof buildPaidChain>) => void, request = PAID) {
  const ctx = buildPaidChain(request);
  mutate(ctx);
  return verifyInstantReceipt(ctx.input);
}

function fundingTx(ctx: ReturnType<typeof buildPaidChain>): Json {
  return txJson(ctx.chain, ctx.input.fundingTransaction.hash);
}

/** Finds a receipt/outcome pair by the contract-action kind it carries. */
function byKind(tx: Json, kind: 'transfer' | 'callback' | 'first') {
  const rs = receipts(tx);
  const os = outcomes(tx);
  const index = rs.findIndex((r) => {
    const actions = actionOf(r)['actions'] as Json[];
    const a = actions[0] as Json;
    if (kind === 'transfer') return r['predecessor_id'] !== 'system' && 'Transfer' in a;
    if (kind === 'callback')
      return 'FunctionCall' in a && (a['FunctionCall'] as Json)['method_name'] === 'on_native_transfer_complete';
    return 'FunctionCall' in a && (a['FunctionCall'] as Json)['method_name'] !== 'on_native_transfer_complete';
  });
  const r = rs[index] as Json;
  const o = os.find((x) => x['id'] === r['receipt_id']) as Json;
  return {
    receipt: r,
    action: actionOf(r),
    outcome: o,
    inner: o['outcome'] as Json,
  };
}

describe('verifyInstantReceipt — positive', () => {
  it('verifies a single-attempt payment and produces a schema-valid VerifiedReceipt', async () => {
    const { input } = buildPaidChain(PAID);
    const result = await verifyInstantReceipt(input);
    expect(result.kind).toBe('verified');
    if (result.kind !== 'verified') return;
    const r = result.receipt;
    expect(VerifiedReceiptSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({
      finalStatus: 'FINAL_PAID',
      mode: 'instant',
      requestId: PAID.terms.id,
      termsHash: PAID.termsHash,
      payerAccountId: PAID.payerAccountId,
      recipientAccountId: PAID.recipientAccountId,
      settlementBeneficiaryAccountId: PAID.recipientAccountId,
      amountBaseUnits: PAID.terms.amountBaseUnits,
      operationNonce: '1',
      contractCodeHash: APPROVED_CODE_HASH,
      verification: {
        state: 'verified_final',
        executionFinality: 'FINAL',
        trustModel: 'configured-rpc',
        rpcProviderId: 'fake-testnet',
      },
    });
    // No retry: the funding transaction is also the settlement transaction.
    expect(r.settlementTransaction).toEqual(r.fundingTransaction);
    expect(r.fundingReceipt.block.timestampNs).toBe(PAID.fundedAtNs);
    expect(r.callbackReceipt.block.timestampNs).toBe(PAID.latestOperation?.resolvedAtNs);
    expect(r.transferReceipt.executorAccountId).toBe(PAID.recipientAccountId);
  });

  it('verifies a payment completed by a recipient retry (nonce 2)', async () => {
    const { input } = buildPaidChain(RETRIED);
    const result = await verifyInstantReceipt(input);
    expect(reason(result)).toBe('verified');
    if (result.kind !== 'verified') return;
    expect(result.receipt.operationNonce).toBe('2');
    expect(result.receipt.settlementTransaction.signerAccountId).toBe(RETRIED.recipientAccountId);
    expect(result.receipt.fundingTransaction.signerAccountId).toBe(RETRIED.payerAccountId);
    expect(result.receipt.settlementTransaction.hash).not.toBe(result.receipt.fundingTransaction.hash);
  });

  it('only reads: every RPC method used is a read method', async () => {
    const { input, chain } = buildPaidChain(RETRIED);
    await verifyInstantReceipt(input);
    const methods = new Set(chain.calls.map((c) => c.method));
    expect([...methods].sort()).toEqual(['EXPERIMENTAL_tx_status', 'block', 'query', 'status']);
    for (const call of chain.calls) expect(JSON.stringify(call.params)).not.toMatch(/broadcast|send_tx/);
  });
});

describe('verifyInstantReceipt — contract state alone never verifies', () => {
  it.each([
    ['OPEN', open],
    ['PAYOUT_IN_FLIGHT', inFlight],
    ['PAYOUT_FAILED_RECOVERABLE', failed],
  ])('refuses %s as NOT_FINAL_PAID', async (_label, fixture) => {
    const request = ContractRequestSchema.parse(fixture);
    const result = await mutated((ctx) => {
      ctx.chain.state = fixture;
      Object.assign(ctx.input, {
        requestId: request.terms.id,
        contractId: request.terms.contractId,
      });
    });
    expect(reason(result)).toBe('NOT_FINAL_PAID');
    expect(result.kind === 'not_verified' && result.transient).toBe(true);
  });

  it('refuses FINAL_PAID state when the funding transaction cannot be found', async () => {
    const result = await mutated((ctx) => ctx.chain.txs.clear());
    expect(reason(result)).toBe('TRANSACTION_NOT_FOUND');
  });

  it('refuses an unknown request', async () => {
    expect(reason(await mutated((ctx) => (ctx.chain.state = null)))).toBe('REQUEST_NOT_FOUND');
  });

  it('refuses state whose terms were altered without the hash', async () => {
    const result = await mutated((ctx) => {
      ctx.chain.state = { ...PAID, terms: { ...PAID.terms, memo: 'changed' } };
    });
    expect(reason(result)).toBe('STATE_INVALID');
  });
});

describe('verifyInstantReceipt — environment', () => {
  it('refuses a non-testnet RPC', async () => {
    const result = await mutated((ctx) => (ctx.chain.status['genesis_hash'] = hashOf('mainnet')));
    expect(reason(result)).toBe('NETWORK_MISMATCH');
  });

  it('refuses a different code hash at the state block', async () => {
    const result = await mutated((ctx) => ctx.chain.codeHashAt.set(ctx.chain.final.hash, hashOf('evil-code')));
    expect(reason(result)).toBe('CODE_HASH_MISMATCH');
  });

  it('refuses a different code hash where the callback ran', async () => {
    const result = await mutated((ctx) => {
      const cb = byKind(fundingTx(ctx), 'callback');
      ctx.chain.codeHashAt.set(String(cb.outcome['block_hash']), hashOf('evil-code'));
    });
    expect(reason(result)).toBe('CODE_HASH_MISMATCH');
  });

  it('refuses when the contract account signed anything during the payment (retained key used)', async () => {
    const result = await mutated((ctx) => {
      ctx.chain.keysAt.set(ctx.chain.final.hash, [
        {
          public_key: 'ed25519:Ops1111111111111111111111111111111111111111',
          access_key: { nonce: 190_000_000_000_008, permission: 'FullAccess' },
        },
      ]);
    });
    expect(reason(result)).toBe('CONTRACT_ACCOUNT_ACTIVITY');
  });

  it('refuses when a key was added during the payment', async () => {
    const result = await mutated((ctx) => {
      ctx.chain.keysAt.set(ctx.chain.final.hash, [
        ...ctx.chain.defaultKeys,
        {
          public_key: 'ed25519:New11111111111111111111111111111111111111111',
          access_key: { nonce: 1, permission: 'FullAccess' },
        },
      ]);
    });
    expect(reason(result)).toBe('CONTRACT_ACCOUNT_ACTIVITY');
  });

  it('reports a pruned block as HISTORY_UNAVAILABLE, not as a mismatch', async () => {
    const result = await mutated((ctx) => {
      const cb = byKind(fundingTx(ctx), 'callback');
      ctx.chain.blocks.delete(String(cb.outcome['block_hash']));
    });
    expect(reason(result)).toBe('HISTORY_UNAVAILABLE');
  });

  it('reports RPC failure as transient RPC_UNAVAILABLE', async () => {
    const result = await mutated((ctx) =>
      ctx.chain.failing.set('EXPERIMENTAL_tx_status', new VerifierRpcError('RPC_UNAVAILABLE')),
    );
    expect(reason(result)).toBe('RPC_UNAVAILABLE');
    expect(result.kind === 'not_verified' && result.transient).toBe(true);
  });

  it('rejects malformed input before any RPC call', async () => {
    const ctx = buildPaidChain(PAID);
    const result = await verifyInstantReceipt({
      ...ctx.input,
      fundingTransaction: { hash: 'not-a-hash', signerAccountId: 'x' },
    });
    expect(reason(result)).toBe('INPUT_INVALID');
    expect(ctx.chain.calls).toHaveLength(0);
  });
});

describe('verifyInstantReceipt — funding transaction and payer authorization', () => {
  it('refuses a deposit one yoctoNEAR short', async () => {
    const result = await mutated((ctx) => {
      const tx = fundingTx(ctx);
      const action = ((tx['transaction'] as Json)['actions'] as Json[])[0] as Json;
      const fc = action['FunctionCall'] as Json;
      fc['deposit'] = (BigInt(PAID.terms.amountBaseUnits) - 1n).toString();
    });
    expect(reason(result)).toBe('FUNDING_MISMATCH');
  });

  it('refuses a funding reference signed by someone other than the recorded payer', async () => {
    const result = await mutated((ctx) => {
      (ctx.input as { fundingTransaction: unknown }).fundingTransaction = {
        hash: ctx.input.fundingTransaction.hash,
        signerAccountId: 'mallory.testnet',
      };
    });
    expect(reason(result)).toBe('FUNDING_MISMATCH');
  });

  it('refuses funding arguments for a different terms hash', async () => {
    const result = await mutated((ctx) => {
      const tx = fundingTx(ctx);
      const fc = (((tx['transaction'] as Json)['actions'] as Json[])[0] as Json)['FunctionCall'] as Json;
      fc['args'] = encodeArgs({
        id: PAID.terms.id,
        expectedTermsHash: '0'.repeat(64),
      });
    });
    expect(reason(result)).toBe('FUNDING_MISMATCH');
  });

  it('refuses funding arguments with a duplicated key', async () => {
    const result = await mutated((ctx) => {
      const tx = fundingTx(ctx);
      const fc = (((tx['transaction'] as Json)['actions'] as Json[])[0] as Json)['FunctionCall'] as Json;
      const raw = `{"id":"${PAID.terms.id}","expectedTermsHash":"${PAID.termsHash}","id":"${PAID.terms.id}"}`;
      fc['args'] = Buffer.from(raw).toString('base64');
    });
    expect(reason(result)).toBe('FUNDING_MISMATCH');
  });

  it('refuses a transaction carrying a second action', async () => {
    const result = await mutated((ctx) => {
      const t = fundingTx(ctx)['transaction'] as Json;
      (t['actions'] as Json[]).push({ Transfer: { deposit: '1' } });
    });
    expect(reason(result)).toBe('FUNDING_MISMATCH');
  });

  it('refuses a funding transaction sent to another contract', async () => {
    const result = await mutated((ctx) => ((fundingTx(ctx)['transaction'] as Json)['receiver_id'] = 'other.testnet'));
    expect(reason(result)).toBe('FUNDING_MISMATCH');
  });

  it('refuses a transaction that is not FINAL yet', async () => {
    const result = await mutated((ctx) => (fundingTx(ctx)['final_execution_status'] = 'EXECUTED_OPTIMISTIC'));
    expect(reason(result)).toBe('NOT_FINAL');
  });
});

describe('verifyInstantReceipt — transfer receipt', () => {
  it('refuses a transfer to an account other than the immutable recipient', async () => {
    const result = await mutated(
      (ctx) => (byKind(fundingTx(ctx), 'transfer').receipt['receiver_id'] = 'mallory.testnet'),
    );
    expect(reason(result)).toBe('TRANSFER_MISMATCH');
  });

  it('refuses a transfer of a different amount', async () => {
    const result = await mutated((ctx) => {
      const action = byKind(fundingTx(ctx), 'transfer').action;
      action['actions'] = [{ Transfer: { deposit: '1' } }];
    });
    expect(reason(result)).toBe('TRANSFER_MISMATCH');
  });

  it('refuses a failed final transfer', async () => {
    const result = await mutated(
      (ctx) =>
        (byKind(fundingTx(ctx), 'transfer').inner['status'] = {
          Failure: { ActionError: {} },
        }),
    );
    expect(reason(result)).toBe('TRANSFER_MISMATCH');
  });

  it('refuses a second contract transfer in the same attempt', async () => {
    const result = await mutated((ctx) => {
      const tx = fundingTx(ctx);
      const t = byKind(tx, 'transfer');
      const first = byKind(tx, 'first');
      const extraId = hashOf('extra-transfer');
      receipts(tx).push({ ...structuredClone(t.receipt), receipt_id: extraId });
      outcomes(tx).push({
        ...structuredClone(t.outcome),
        id: extraId,
        outcome: { ...structuredClone(t.inner), receipt_ids: [] },
      });
      (first.inner['receipt_ids'] as string[]).push(extraId);
    });
    expect(reason(result)).toBe('TRANSFER_MISMATCH');
  });

  it('refuses a receipt that is not executed (unknown status)', async () => {
    const result = await mutated((ctx) => (byKind(fundingTx(ctx), 'transfer').inner['status'] = 'Started'));
    expect(reason(result)).toBe('NOT_FINAL');
  });

  it('refuses a graph with a missing outcome', async () => {
    const result = await mutated((ctx) => {
      const tx = fundingTx(ctx);
      const id = byKind(tx, 'transfer').receipt['receipt_id'];
      tx['receipts_outcome'] = outcomes(tx).filter((o) => o['id'] !== id);
    });
    expect(reason(result)).toBe('EVIDENCE_INCOMPLETE');
  });

  it('refuses an unexpected non-refund receipt in the graph', async () => {
    const result = await mutated((ctx) => {
      const tx = fundingTx(ctx);
      const t = byKind(tx, 'transfer');
      const extraId = hashOf('sneaky');
      receipts(tx).push({
        ...structuredClone(t.receipt),
        receipt_id: extraId,
        predecessor_id: 'mallory.testnet',
      });
      outcomes(tx).push({
        ...structuredClone(t.outcome),
        id: extraId,
        outcome: { ...structuredClone(t.inner), receipt_ids: [] },
      });
      (t.inner['receipt_ids'] as string[]).push(extraId);
    });
    expect(reason(result)).toBe('EVIDENCE_INCONSISTENT');
  });
});

describe('verifyInstantReceipt — protocol refunds', () => {
  it('accepts gas refunds to the signer (sandbox topology) but refuses a "refund" to a third account', async () => {
    expect(reason(await mutated(() => undefined))).toBe('verified');
    const result = await mutated((ctx) => {
      const tx = fundingTx(ctx);
      const refund = receipts(tx).find((r) => r['predecessor_id'] === 'system');
      if (refund === undefined) throw new Error('fixture has no refund');
      refund['receiver_id'] = 'mallory.testnet';
    });
    expect(reason(result)).toBe('EVIDENCE_INCONSISTENT');
  });
});

describe('verifyInstantReceipt — callback receipt', () => {
  it('refuses a callback for a different nonce', async () => {
    const result = await mutated((ctx) => {
      const cb = byKind(fundingTx(ctx), 'callback');
      const fc = ((cb.action['actions'] as Json[])[0] as Json)['FunctionCall'] as Json;
      fc['args'] = encodeArgs({
        id: PAID.terms.id,
        operationNonce: '7',
        kind: 'INSTANT_PAYOUT',
      });
    });
    expect(reason(result)).toBe('CALLBACK_MISMATCH');
  });

  it('refuses a callback not wired to the transfer result', async () => {
    const result = await mutated(
      (ctx) => (byKind(fundingTx(ctx), 'callback').action['input_data_ids'] = [hashOf('other-data')]),
    );
    expect(reason(result)).toBe('CALLBACK_MISMATCH');
  });

  it('refuses a final callback that returned false', async () => {
    const result = await mutated(
      (ctx) =>
        (byKind(fundingTx(ctx), 'callback').inner['status'] = {
          SuccessValue: 'ZmFsc2U=',
        }),
    );
    expect(reason(result)).toBe('CALLBACK_MISMATCH');
  });

  it('refuses a callback that panicked', async () => {
    const result = await mutated(
      (ctx) =>
        (byKind(fundingTx(ctx), 'callback').inner['status'] = {
          Failure: { ActionError: {} },
        }),
    );
    expect(reason(result)).toBe('CALLBACK_MISMATCH');
  });

  it('refuses a callback executed by another account', async () => {
    const result = await mutated(
      (ctx) => (byKind(fundingTx(ctx), 'callback').inner['executor_id'] = 'mallory.testnet'),
    );
    expect(reason(result)).toBe('CALLBACK_MISMATCH');
  });

  it('refuses a missing payout_succeeded event', async () => {
    const result = await mutated((ctx) => (byKind(fundingTx(ctx), 'callback').inner['logs'] = []));
    expect(reason(result)).toBe('EVENT_MISMATCH');
  });

  it('refuses an event for another request', async () => {
    const result = await mutated((ctx) => {
      const cb = byKind(fundingTx(ctx), 'callback');
      cb.inner['logs'] = [(cb.inner['logs'] as string[])[0]?.replace(PAID.terms.id, 'f'.repeat(64))];
    });
    expect(reason(result)).toBe('EVENT_MISMATCH');
  });
});

describe('verifyInstantReceipt — retries and consistency', () => {
  it('refuses when the retry reference is missing', async () => {
    const result = await mutated((ctx) => {
      (ctx.input as { retryTransactions: unknown }).retryTransactions = [];
    }, RETRIED);
    expect(reason(result)).toBe('EVIDENCE_INCOMPLETE');
  });

  it('refuses more retries than the contract recorded', async () => {
    const result = await mutated((ctx) => {
      (ctx.input as { retryTransactions: unknown }).retryTransactions = [
        { hash: hashOf('x'), signerAccountId: PAID.recipientAccountId },
      ];
    });
    expect(reason(result)).toBe('EVIDENCE_INCONSISTENT');
  });

  it('refuses when the earlier attempt actually transferred (would be a double payment)', async () => {
    const result = await mutated((ctx) => {
      const tx = fundingTx(ctx);
      byKind(tx, 'transfer').inner['status'] = { SuccessValue: '' };
    }, RETRIED);
    expect(reason(result)).toBe('EVIDENCE_INCONSISTENT');
  });

  it('refuses a retry signed by the payer', async () => {
    const result = await mutated((ctx) => {
      const ref = ctx.input.retryTransactions[0];
      if (ref === undefined) throw new Error('no retry');
      const tx = txJson(ctx.chain, ref.hash);
      (tx['transaction'] as Json)['signer_id'] = RETRIED.payerAccountId;
      (ctx.input as { retryTransactions: unknown }).retryTransactions = [
        { hash: ref.hash, signerAccountId: RETRIED.payerAccountId },
      ];
      (tx['transaction_outcome'] as Json)['outcome'] = {
        ...((tx['transaction_outcome'] as Json)['outcome'] as Json),
        executor_id: RETRIED.payerAccountId,
      };
    }, RETRIED);
    expect(reason(result)).toBe('RETRY_MISMATCH');
  });

  it('refuses when fundedAtNs is not the funding block time', async () => {
    const result = await mutated((ctx) => {
      ctx.chain.state = {
        ...PAID,
        fundedAtNs: (BigInt(PAID.fundedAtNs ?? '0') - 1n).toString(),
      };
    });
    // Either the shared schema or the timing rule must refuse; never verified.
    expect(['TIMING_MISMATCH', 'STATE_INVALID']).toContain(reason(result));
  });

  it('refuses receipts dated after the state block', async () => {
    const result = await mutated((ctx) => {
      ctx.chain.final = { ...ctx.chain.final, height: 1 };
    });
    expect(reason(result)).toBe('TIMING_MISMATCH');
  });
});
