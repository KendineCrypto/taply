import { createHash } from 'node:crypto';
import { TESTNET_GENESIS_HASH } from '@taply/near-client';
import type { ContractRequest } from '@/lib/protocol';
import { VerifierRpcError } from '../rpc';
import type { VerifierMethod, VerifierRpc } from '../rpc';
import type { TxRef, VerifyInstantInput } from '../instant-receipt';

/**
 * A deterministic, in-memory NEAR Testnet for verifier tests.
 *
 * SYNTHETIC: the transaction JSON follows the documented `EXPERIMENTAL_tx_status`
 * shape (transaction, transaction_outcome, receipts_outcome, receipts with
 * Action payloads and data dependencies), but it is NOT a recording of a real
 * Testnet transaction - none exists yet. The contract request records ARE real
 * sandbox outputs (src/test/fixtures/sandbox). Validating the verifier against a
 * real Testnet payment is an open gate.
 */

export const APPROVED_CODE_HASH = 'BrR6bioUxuLzYD9m3TMSXmY9KYiLSrq3DSnQrfP6iZ9B';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function hashOf(label: string): string {
  const bytes = createHash('sha256').update(label).digest();
  let n = BigInt(`0x${bytes.toString('hex')}`);
  let out = '';
  while (n > 0n) {
    out = (B58[Number(n % 58n)] as string) + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const clone = <T>(value: T): T => structuredClone(value);

type Json = Record<string, unknown>;

export interface BlockSpec {
  readonly hash: string;
  readonly prevHash: string;
  readonly height: number;
  readonly timestampNs: string;
}

export interface FakeChain {
  status: Json;
  final: BlockSpec;
  blocks: Map<string, BlockSpec>;
  txs: Map<string, Json>;
  codeHashAt: Map<string, string>;
  defaultCodeHash: string;
  keysAt: Map<string, Json[]>;
  defaultKeys: Json[];
  state: unknown;
  /** Methods that should fail, for transport-failure tests. */
  failing: Map<VerifierMethod, VerifierRpcError>;
  calls: Array<{ method: VerifierMethod; params: unknown }>;
}

export function fakeRpc(chain: FakeChain): VerifierRpc {
  return {
    providerId: 'fake-testnet',
    async call(method, params) {
      chain.calls.push({ method, params });
      const failure = chain.failing.get(method);
      if (failure !== undefined) throw failure;
      const p = params as Json;
      switch (method) {
        case 'status':
          return clone(chain.status);
        case 'block': {
          const block = p['finality'] === 'final' ? chain.final : chain.blocks.get(String(p['block_id']));
          if (block === undefined) throw new VerifierRpcError('UNKNOWN_BLOCK');
          return {
            header: {
              hash: block.hash,
              prev_hash: block.prevHash,
              height: block.height,
              timestamp_nanosec: block.timestampNs,
            },
          };
        }
        case 'query': {
          const blockId = String(p['block_id']);
          if (blockId !== chain.final.hash && !chain.blocks.has(blockId) && !chain.keysAt.has(blockId)) {
            throw new VerifierRpcError('UNKNOWN_BLOCK');
          }
          if (p['request_type'] === 'view_account') {
            return {
              code_hash: chain.codeHashAt.get(blockId) ?? chain.defaultCodeHash,
              block_hash: blockId,
              block_height: 1,
            };
          }
          if (p['request_type'] === 'view_access_key_list') {
            return {
              keys: clone(chain.keysAt.get(blockId) ?? chain.defaultKeys),
              block_hash: blockId,
              block_height: 1,
            };
          }
          if (p['request_type'] === 'call_function') {
            const bytes = [...Buffer.from(JSON.stringify(chain.state), 'utf8')];
            return {
              result: bytes,
              logs: [],
              block_hash: blockId,
              block_height: 1,
            };
          }
          throw new VerifierRpcError('RPC_ERROR');
        }
        case 'EXPERIMENTAL_tx_status': {
          const tx = chain.txs.get(String(p['tx_hash']));
          if (tx === undefined) throw new VerifierRpcError('UNKNOWN_TRANSACTION');
          return clone(tx);
        }
      }
    },
  };
}

function event(name: string, request: ContractRequest, status: string, nonce: number, revision: number): string {
  return `EVENT_JSON:${JSON.stringify({
    standard: 'taply',
    version: '0.4.0',
    event: name,
    data: [
      {
        id: request.terms.id,
        termsHash: request.termsHash,
        status,
        revision: String(revision),
        operationNonce: String(nonce),
      },
    ],
  })}`;
}

function outcome(
  id: string,
  blockHash: string,
  executor: string,
  receiptIds: string[],
  status: unknown,
  logs: string[] = [],
): Json {
  return {
    id,
    block_hash: blockHash,
    proof: [],
    outcome: {
      executor_id: executor,
      receipt_ids: receiptIds,
      status,
      logs,
      gas_burnt: 2_428_000_000_000,
      tokens_burnt: '242800000000000000000',
      metadata: { version: 3, gas_profile: [] },
    },
  };
}

function receipt(
  id: string,
  predecessor: string,
  receiver: string,
  signer: string,
  actions: unknown[],
  extra: Json = {},
): Json {
  return {
    receipt_id: id,
    predecessor_id: predecessor,
    receiver_id: receiver,
    priority: 0,
    receipt: {
      Action: {
        signer_id: signer,
        signer_public_key: 'ed25519:4fFQ2bhhxYmGsrGCJT5nFw8M5ZWBYhQ1uymy8hTLFRyP',
        gas_price: '100000000',
        output_data_receivers: [],
        input_data_ids: [],
        actions,
        is_promise_yield: false,
        ...extra,
      },
    },
  };
}

interface AttemptSpec {
  readonly label: string;
  readonly signer: string;
  readonly method: 'pay_instant_native' | 'retry_native_transfer';
  readonly args: Json;
  readonly deposit: string;
  readonly nonce: number;
  readonly succeeded: boolean;
  readonly blocks: {
    readonly first: BlockSpec;
    readonly transfer: BlockSpec;
    readonly callback: BlockSpec;
  };
}

/** One funding/retry transaction as the frozen contract would produce it. */
function attemptTx(request: ContractRequest, spec: AttemptSpec): { hash: string; json: Json } {
  const contract = request.terms.contractId;
  const recipient = request.recipientAccountId;
  const hash = hashOf(`${spec.label}:tx`);
  const r0 = hashOf(`${spec.label}:r0`);
  const t = hashOf(`${spec.label}:transfer`);
  const c = hashOf(`${spec.label}:callback`);
  const refund = hashOf(`${spec.label}:refund`);
  const data = hashOf(`${spec.label}:data`);
  const call = {
    FunctionCall: {
      method_name: spec.method,
      args: b64(JSON.stringify(spec.args)),
      gas: 50_000_000_000_000,
      deposit: spec.deposit,
    },
  };
  const callbackArgs = {
    id: request.terms.id,
    kind: 'INSTANT_PAYOUT',
    operationNonce: String(spec.nonce),
  };
  const ok = spec.succeeded;
  // Topology mirrors the near-workspaces pay receipt graph (CI run 41244144449):
  // the contract receipt, the transfer and the callback each spawn a gas refund to
  // the signer (predecessor "system"). A failed transfer also refunds its deposit
  // to the contract.
  const gasRefund = (label: string) => hashOf(`${spec.label}:gas-refund:${label}`);
  const refundR0 = gasRefund('r0');
  const refundT = gasRefund('transfer');
  const refundC = gasRefund('callback');
  const transferChildren = ok ? [refundT] : [refundT, refund];
  const systemTransfer = (id: string, to: string, deposit: string) =>
    receipt(id, 'system', to, 'system', [{ Transfer: { deposit } }]);
  const receipts: Json[] = [
    receipt(r0, spec.signer, contract, spec.signer, [call]),
    receipt(t, contract, recipient, spec.signer, [{ Transfer: { deposit: request.terms.amountBaseUnits } }], {
      output_data_receivers: [{ data_id: data, receiver_id: contract }],
    }),
    receipt(
      c,
      contract,
      contract,
      spec.signer,
      [
        {
          FunctionCall: {
            method_name: 'on_native_transfer_complete',
            args: b64(JSON.stringify(callbackArgs)),
            gas: 15_000_000_000_000,
            deposit: '0',
          },
        },
      ],
      { input_data_ids: [data] },
    ),
    systemTransfer(refundR0, spec.signer, '21000000000000000000'),
    systemTransfer(refundT, spec.signer, '2000000000000000000'),
    systemTransfer(refundC, spec.signer, '1200000000000000000'),
  ];
  if (!ok) receipts.push(systemTransfer(refund, contract, request.terms.amountBaseUnits));
  const result = b64(ok ? 'true' : 'false');
  const refundOutcome = (id: string, blockHash: string, executor: string) =>
    outcome(id, blockHash, executor, [], { SuccessValue: '' });
  const outcomes: Json[] = [
    outcome(r0, spec.blocks.first.hash, contract, [t, c, refundR0], { SuccessReceiptId: c }, [
      event('payout_started', request, 'PAYOUT_IN_FLIGHT', spec.nonce, spec.nonce * 2),
    ]),
    outcome(
      t,
      spec.blocks.transfer.hash,
      recipient,
      transferChildren,
      ok ? { SuccessValue: '' } : { Failure: { ActionError: { index: 0, kind: { LackBalanceForState: {} } } } },
    ),
    outcome(c, spec.blocks.callback.hash, contract, [refundC], { SuccessValue: result }, [
      event(
        ok ? 'payout_succeeded' : 'payout_failed',
        request,
        ok ? 'FINAL_PAID' : 'PAYOUT_FAILED_RECOVERABLE',
        spec.nonce,
        spec.nonce * 2 + 1,
      ),
    ]),
    refundOutcome(refundR0, spec.blocks.transfer.hash, spec.signer),
    refundOutcome(refundT, spec.blocks.callback.hash, spec.signer),
    refundOutcome(refundC, spec.blocks.callback.hash, spec.signer),
  ];
  if (!ok) outcomes.push(refundOutcome(refund, spec.blocks.callback.hash, contract));
  return {
    hash,
    json: {
      final_execution_status: 'FINAL',
      status: { SuccessValue: result },
      transaction: {
        signer_id: spec.signer,
        public_key: 'ed25519:4fFQ2bhhxYmGsrGCJT5nFw8M5ZWBYhQ1uymy8hTLFRyP',
        nonce: 187_000_000_000_001,
        receiver_id: contract,
        actions: [call],
        priority_fee: 0,
        signature: 'ed25519:3s1dvZdQtcAjBksMHFrysqvF63wnyMHPA4owNQmCJZ2EBakZEKdtMsLqrHdKWQjJbSRN6kRknN2WdwSBLWGCokXj',
        hash,
      },
      transaction_outcome: outcome(hash, spec.blocks.first.hash, spec.signer, [r0], { SuccessReceiptId: r0 }),
      receipts_outcome: outcomes,
      receipts,
    },
  };
}

function add(ns: string, delta: bigint): string {
  return (BigInt(ns) + delta).toString();
}

/**
 * Builds a chain where `request` (a FINAL_PAID sandbox record) was funded and
 * paid out exactly as the frozen contract does it, with one transaction per
 * operation nonce. Returns the chain (mutable, for negative tests) and a ready
 * verifier input.
 */
export function buildPaidChain(request: ContractRequest): {
  chain: FakeChain;
  input: VerifyInstantInput;
} {
  const op = request.latestOperation;
  if (op === null || request.fundedAtNs === null || op.resolvedAtNs === null || request.payerAccountId === null) {
    throw new Error('fixture must be FINAL_PAID');
  }
  const nonces = Number(op.nonce);
  const blocks = new Map<string, BlockSpec>();
  let height = 200_000_000;
  let prev = hashOf('genesis-ish');
  const block = (label: string, timestampNs: string): BlockSpec => {
    const spec = {
      hash: hashOf(`block:${label}`),
      prevHash: prev,
      height: height++,
      timestampNs,
    };
    blocks.set(spec.hash, spec);
    prev = spec.hash;
    return spec;
  };
  const beforeFunding = block('before-funding', add(request.fundedAtNs, -1_000_000n));

  const txs = new Map<string, Json>();
  const refs: TxRef[] = [];
  for (let nonce = 1; nonce <= nonces; nonce++) {
    const last = nonce === nonces;
    const start =
      nonce === 1 ? request.fundedAtNs : last ? op.startedAtNs : add(request.fundedAtNs, BigInt(nonce) * 10_000_000n);
    const first = block(`n${nonce}:first`, start);
    const transfer = block(`n${nonce}:transfer`, add(start, 1_000_000n));
    const callback = block(`n${nonce}:callback`, last ? op.resolvedAtNs : add(start, 2_000_000n));
    const signer = nonce === 1 ? request.payerAccountId : request.recipientAccountId;
    const tx = attemptTx(request, {
      label: `attempt-${nonce}`,
      signer,
      method: nonce === 1 ? 'pay_instant_native' : 'retry_native_transfer',
      args:
        nonce === 1
          ? { id: request.terms.id, expectedTermsHash: request.termsHash }
          : { id: request.terms.id, expectedOperationNonce: String(nonce - 1) },
      deposit: nonce === 1 ? request.terms.amountBaseUnits : '1',
      nonce,
      succeeded: last,
      blocks: { first, transfer, callback },
    });
    txs.set(tx.hash, tx.json);
    refs.push({ hash: tx.hash, signerAccountId: signer });
  }
  const final = block('final', add(op.resolvedAtNs, 5_000_000_000n));
  const chain: FakeChain = {
    status: {
      chain_id: 'testnet',
      genesis_hash: TESTNET_GENESIS_HASH,
      sync_info: { syncing: false },
      version: { version: '2.14.0' },
    },
    final,
    blocks,
    txs,
    codeHashAt: new Map(),
    defaultCodeHash: APPROVED_CODE_HASH,
    keysAt: new Map(),
    defaultKeys: [
      {
        public_key: 'ed25519:Ops1111111111111111111111111111111111111111',
        access_key: { nonce: 190_000_000_000_007, permission: 'FullAccess' },
      },
    ],
    state: request,
    failing: new Map(),
    calls: [],
  };
  void beforeFunding;
  const [funding, ...retries] = refs;
  if (funding === undefined) throw new Error('no funding');
  return {
    chain,
    input: {
      rpc: fakeRpc(chain),
      contractId: request.terms.contractId,
      approvedCodeHash: APPROVED_CODE_HASH,
      requestId: request.terms.id,
      fundingTransaction: funding,
      retryTransactions: retries,
      now: () => new Date('2026-11-01T12:00:00.000Z'),
    },
  };
}

/** Helpers for poking at one transaction's JSON in negative tests. */
export function txJson(chain: FakeChain, hash: string): Json {
  const tx = chain.txs.get(hash);
  if (tx === undefined) throw new Error('unknown tx');
  return tx;
}

export function outcomes(tx: Json): Json[] {
  return tx['receipts_outcome'] as Json[];
}

export function receipts(tx: Json): Json[] {
  return tx['receipts'] as Json[];
}

export function actionOf(r: Json): Json {
  return (r['receipt'] as Json)['Action'] as Json;
}

export function encodeArgs(value: unknown): string {
  return b64(JSON.stringify(value));
}
