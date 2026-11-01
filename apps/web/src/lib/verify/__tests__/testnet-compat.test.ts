import { describe, expect, it } from 'vitest';
import linkdrop from './fixtures/testnet/linkdrop-create-account-callback.json';
import failedCall from './fixtures/testnet/failed-call-with-refunds.json';
import { buildTxGraph, isRefund, parseTxStatus, promiseResultProducer, verifyInstantReceipt } from '../instant-receipt';
import type { TxGraph, TxReceipt } from '../instant-receipt';
import { VerifierRpcError } from '../rpc';
import type { VerifierRpc } from '../rpc';
import { APPROVED_CODE_HASH, buildPaidChain } from './fake-chain';
import { ContractRequestSchema } from '@/lib/protocol';
import paidRestricted from '@/test/fixtures/sandbox/paid-restricted.json';

/**
 * RPC compatibility against GENUINE public Testnet responses (see fixtures/testnet/README.md).
 * These are unrelated transactions, not Taply payments: they test parsing and graph
 * handling of real RPC output, never that a Taply payment was verified.
 */

type Json = Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);
const refOf = (st: { transaction: { hash: string; signer_id: string } }) => ({
  hash: st.transaction.hash,
  signerAccountId: st.transaction.signer_id,
});

function failure(fn: () => unknown): string {
  try {
    fn();
    return 'ok';
  } catch (error) {
    return error instanceof Error ? (error.message.split(':')[0] ?? 'error') : 'error';
  }
}

function graphOf(raw: unknown): TxGraph {
  const value = parseTxStatus(raw);
  return buildTxGraph(value, refOf(value));
}

describe('genuine Testnet: promise + transfer + callback (linkdrop create_account)', () => {
  const graph = graphOf(linkdrop);
  const receipts = [...graph.receipts.values()];
  const byPred = (pred: string) => receipts.filter((r) => r.predecessor === pred);

  it('parses with the verifier schemas and forms one complete FINAL tree', () => {
    expect(graph.outcomes.size).toBe(6);
    expect(graph.receipts.size).toBe(6);
    expect(graph.first.executor).toBe('testnet');
    // The node listed the first receipt, and it matches the signed transaction.
    expect(graph.firstPayload?.predecessor).toBe('meteor-relay.testnet');
  });

  it('the contract receipt returns the callback promise', () => {
    const callback = receipts.find((r) => r.inputDataIds.length === 1) as TxReceipt;
    expect(graph.first.status).toEqual({ kind: 'receipt', receiptId: callback.id });
    expect(callback.predecessor).toBe('testnet');
    expect(callback.receiver).toBe('testnet');
  });

  it('the callback consumes exactly the outgoing transfer receipt result (data dependency)', () => {
    const callback = receipts.find((r) => r.inputDataIds.length === 1) as TxReceipt;
    const producer = promiseResultProducer(graph, callback);
    expect(producer?.receiver).toBe('manex-agent.testnet');
    expect(producer?.actions.some((a) => a.kind === 'transfer')).toBe(true);
    // String actions such as "CreateAccount" parse as `other` (Taply would refuse them).
    expect(producer?.actions.map((a) => a.kind)).toEqual(['other', 'other', 'transfer']);
    expect(graph.outcomes.get(callback.id)?.status).toEqual({ kind: 'value', base64: 'dHJ1ZQ==' });
  });

  it('every gas refund is a system Transfer to the signer and is classified as a refund', () => {
    const refunds = byPred('system');
    expect(refunds).toHaveLength(3);
    for (const r of refunds) expect(isRefund(r, ['meteor-relay.testnet'])).toBe(true);
    // ... and never as a refund to anyone else.
    for (const r of refunds) expect(isRefund(r, ['manex-agent.testnet'])).toBe(false);
  });

  it('a node that omits the first receipt payload is still handled (derived from the transaction)', () => {
    const raw = clone(linkdrop) as Json;
    const firstId = ((raw['transaction_outcome'] as Json)['outcome'] as Json)['receipt_ids'] as string[];
    raw['receipts'] = (raw['receipts'] as Json[]).filter((r) => r['receipt_id'] !== firstId[0]);
    const g = graphOf(raw);
    expect(g.firstPayload).toBeNull();
    expect(g.first.executor).toBe('testnet');
  });

  it.each([
    ['not FINAL', (raw: Json) => (raw['final_execution_status'] = 'EXECUTED_OPTIMISTIC'), 'NOT_FINAL'],
    [
      'missing outcome',
      (raw: Json) => (raw['receipts_outcome'] = (raw['receipts_outcome'] as Json[]).slice(1)),
      'EVIDENCE_INCOMPLETE',
    ],
    [
      'outcome not executed',
      (raw: Json) => ((((raw['receipts_outcome'] as Json[])[1] as Json)['outcome'] as Json)['status'] = 'Started'),
      'NOT_FINAL',
    ],
    [
      'first receipt altered',
      (raw: Json) => (((raw['receipts'] as Json[])[0] as Json)['predecessor_id'] = 'mallory.testnet'),
      'EVIDENCE_INCONSISTENT',
    ],
    [
      'duplicate outcome',
      (raw: Json) => (raw['receipts_outcome'] as Json[]).push(clone((raw['receipts_outcome'] as Json[])[0] as Json)),
      'EVIDENCE_INCONSISTENT',
    ],
  ])('fails closed on a real response with %s', (_label, mutate, expected) => {
    const raw = clone(linkdrop) as Json;
    mutate(raw);
    expect(failure(() => graphOf(raw))).toBe(expected);
  });
});

describe('genuine Testnet: failed contract call with refunds', () => {
  it('parses; failure status and system refunds are recognised', () => {
    const value = parseTxStatus(failedCall);
    expect(value.status.kind).toBe('failure');
    const graph = buildTxGraph(value, refOf(value));
    expect(graph.first.status.kind).toBe('failure');
    const refunds = [...graph.receipts.values()].filter((r) => r.predecessor === 'system');
    expect(refunds.length).toBeGreaterThan(0);
    for (const r of refunds) expect(isRefund(r, [value.transaction.signer_id])).toBe(true);
  });
});

describe('genuine Testnet response through the whole Taply verifier', () => {
  it('a real non-Taply transaction presented as a "funding" reference is refused (never verified)', async () => {
    // Contract state says FINAL_PAID (sandbox record); the RPC returns the real linkdrop tx
    // for the funding hash. Parsing must succeed and the Taply checks must refuse it.
    const request = ContractRequestSchema.parse(paidRestricted);
    const { input, chain } = buildPaidChain(request);
    const real = clone(linkdrop) as Json;
    const base = input.rpc;
    const rpc: VerifierRpc = {
      providerId: base.providerId,
      async call(method, params) {
        if (method === 'EXPERIMENTAL_tx_status') return real;
        return base.call(method, params);
      },
    };
    void chain;
    const result = await verifyInstantReceipt({
      ...input,
      rpc,
      fundingTransaction: { hash: linkdrop.transaction.hash, signerAccountId: request.payerAccountId ?? '' },
    });
    expect(result.kind).toBe('not_verified');
    // Refused by a Taply authorization rule, not by a parse error.
    expect(result.kind === 'not_verified' && result.reason).toBe('FUNDING_MISMATCH');
  });

  it('an RPC that does not know the transaction yields TRANSACTION_NOT_FOUND (retry later, never re-pay)', async () => {
    const request = ContractRequestSchema.parse(paidRestricted);
    const { input } = buildPaidChain(request);
    const rpc: VerifierRpc = {
      providerId: 'x',
      async call(method, params) {
        if (method === 'EXPERIMENTAL_tx_status') throw new VerifierRpcError('UNKNOWN_TRANSACTION');
        return input.rpc.call(method, params);
      },
    };
    const result = await verifyInstantReceipt({ ...input, rpc });
    expect(result).toMatchObject({ kind: 'not_verified', reason: 'TRANSACTION_NOT_FOUND', transient: true });
    expect(APPROVED_CODE_HASH).toBe(input.approvedCodeHash);
  });
});
