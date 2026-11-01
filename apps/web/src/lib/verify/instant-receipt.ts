import { z } from 'zod';
import { TESTNET_GENESIS_HASH } from '@taply/near-client';
import {
  AccountIdSchema,
  ChainHashSchema,
  ContractRequestSchema,
  HashHexSchema,
  VerifiedReceiptSchema,
  calculateRequestId,
  calculateTermsHash,
  parseStrictJson,
} from '@/lib/protocol';
import type { BlockRef, ContractRequest, VerifiedReceipt } from '@/lib/protocol';
import { VerifierRpcError } from './rpc';
import type { VerifierRpc } from './rpc';

/**
 * Independent receipt verifier for the frozen native Instant Pay protocol
 * (contract ABI v0.4.0, `contracts/payments/ABI.md`).
 *
 * It answers one question: does the chain, read through the configured RPC at
 * FINAL, prove that this request's principal reached its recipient under the
 * approved contract code? Only a `verified` result may produce the shared
 * `VerifiedReceipt` and the Verified Paid ribbon.
 *
 * Checked, all at FINAL execution:
 *   1. RPC is NEAR Testnet (genesis hash) and not syncing.
 *   2. Contract state at the latest final block: approved code hash, FINAL_PAID,
 *      self-consistent terms (request ID and terms hash recomputed locally).
 *   3. Funding transaction: signed by the recorded payer, sent directly to the
 *      contract, ONE `pay_instant_native` call for this ID and terms hash with
 *      exactly the principal attached, honouring any payer restriction.
 *   4. Each retry transaction (if the payout needed retries): signed by the
 *      recipient, ONE `retry_native_transfer` with one yoctoNEAR and the right
 *      previous nonce.
 *   5. In every attempt: the contract scheduled exactly one native Transfer of
 *      exactly the principal to the immutable recipient and exactly one private
 *      `on_native_transfer_complete` callback for this ID and nonce, wired to
 *      that transfer's result (data dependency).
 *   6. Earlier attempts: transfer failed AND callback recorded the failure.
 *      Final attempt: transfer succeeded AND callback returned true.
 *   7. Contract events in the receipts agree with the above.
 *   8. Chain times: fundedAtNs, startedAtNs and resolvedAtNs equal the block
 *      timestamps of the receipts that wrote them; receipts are causally ordered
 *      and no later than the state block.
 *   9. Approved code hash at every block where contract code ran.
 *  10. The contract account's access keys (and their nonces) are identical
 *      before funding and at the state block. A retained full-access key that
 *      signed ANY transaction in that window could have swapped code, so the
 *      result is then refused (`CONTRACT_ACCOUNT_ACTIVITY`).
 *
 * Everything else fails closed. Contract state alone never verifies anything:
 * without the transaction hashes there is no receipt to check.
 *
 * Trust model: the configured RPC provider (`trustModel: 'configured-rpc'`).
 * A lying RPC can lie about everything; this is not a light client.
 */

export type VerificationFailure =
  | 'INPUT_INVALID'
  | 'NETWORK_MISMATCH'
  | 'RPC_UNAVAILABLE'
  /** A needed block or state was pruned by a non-archival RPC. */
  | 'HISTORY_UNAVAILABLE'
  | 'TRANSACTION_NOT_FOUND'
  /** A transaction or one of its receipts is not FINAL yet. */
  | 'NOT_FINAL'
  | 'REQUEST_NOT_FOUND'
  /** The contract does not report FINAL_PAID (yet). Not a verdict on the money. */
  | 'NOT_FINAL_PAID'
  | 'STATE_INVALID'
  | 'CODE_HASH_MISMATCH'
  | 'CONTRACT_ACCOUNT_ACTIVITY'
  | 'FUNDING_MISMATCH'
  | 'RETRY_MISMATCH'
  | 'TRANSFER_MISMATCH'
  | 'CALLBACK_MISMATCH'
  | 'EVENT_MISMATCH'
  | 'TIMING_MISMATCH'
  /** Missing transaction references (e.g. a retry hash this device never saw). */
  | 'EVIDENCE_INCOMPLETE'
  | 'EVIDENCE_INCONSISTENT'
  | 'RECEIPT_SCHEMA_REJECTED';

/** Failures that can change by themselves if the reader waits and checks again. */
export const TRANSIENT_FAILURES: ReadonlySet<VerificationFailure> = new Set([
  'RPC_UNAVAILABLE',
  'TRANSACTION_NOT_FOUND',
  'NOT_FINAL',
  'NOT_FINAL_PAID',
]);

export type VerificationResult =
  | { readonly kind: 'verified'; readonly receipt: VerifiedReceipt }
  | {
      readonly kind: 'not_verified';
      readonly reason: VerificationFailure;
      /** Developer diagnostic. Never shown to people, never contains secrets. */
      readonly detail: string;
      readonly transient: boolean;
    };

export interface TxRef {
  readonly hash: string;
  readonly signerAccountId: string;
}

export interface VerifyInstantInput {
  readonly rpc: VerifierRpc;
  readonly contractId: string;
  readonly approvedCodeHash: string;
  readonly requestId: string;
  readonly fundingTransaction: TxRef;
  /** retry_native_transfer transactions in nonce order (nonce 2, 3, ...). */
  readonly retryTransactions: ReadonlyArray<TxRef>;
  readonly now?: () => Date;
}

class Fail extends Error {
  constructor(
    readonly reason: VerificationFailure,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

function fail(reason: VerificationFailure, detail: string): never {
  throw new Fail(reason, detail);
}

function check(condition: boolean, reason: VerificationFailure, detail: string): asserts condition {
  if (!condition) fail(reason, detail);
}

// ---------------------------------------------------------------------------
// RPC shapes. Objects are not strict (nodes add fields over time), but every
// field the verifier relies on is typed exactly.

const Int = z.number().int().nonnegative().transform(String);
const Decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const Base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const Account = z.string().min(2).max(64);

const ActionSchema = z.union([
  z
    .object({
      FunctionCall: z.object({
        method_name: z.string(),
        args: Base64,
        gas: Int,
        deposit: Decimal,
      }),
    })
    .transform((a) => ({
      kind: 'function_call' as const,
      method: a.FunctionCall.method_name,
      argsBase64: a.FunctionCall.args,
      deposit: a.FunctionCall.deposit,
    })),
  z.object({ Transfer: z.object({ deposit: Decimal }) }).transform((a) => ({
    kind: 'transfer' as const,
    deposit: a.Transfer.deposit,
  })),
  // Any other action (string or object) is kept as "other" so it can be refused.
  z.unknown().transform(() => ({ kind: 'other' as const })),
]);
type Action = z.infer<typeof ActionSchema>;

const StatusSchema = z.union([
  z.object({ SuccessValue: Base64 }).transform((s) => ({ kind: 'value' as const, base64: s.SuccessValue })),
  z.object({ SuccessReceiptId: ChainHashSchema }).transform((s) => ({
    kind: 'receipt' as const,
    receiptId: s.SuccessReceiptId,
  })),
  z.object({ Failure: z.unknown() }).transform(() => ({ kind: 'failure' as const })),
  z.unknown().transform(() => ({ kind: 'unknown' as const })),
]);

const OutcomeSchema = z
  .object({
    id: ChainHashSchema,
    block_hash: ChainHashSchema,
    outcome: z.object({
      executor_id: Account,
      receipt_ids: z.array(ChainHashSchema).max(256),
      status: StatusSchema,
      logs: z.array(z.string().max(16_384)).max(256),
    }),
  })
  .transform((o) => ({
    id: o.id,
    blockHash: o.block_hash,
    executor: o.outcome.executor_id,
    receiptIds: o.outcome.receipt_ids,
    status: o.outcome.status,
    logs: o.outcome.logs,
  }));
type Outcome = z.infer<typeof OutcomeSchema>;

const ReceiptSchema = z
  .object({
    receipt_id: ChainHashSchema,
    predecessor_id: Account,
    receiver_id: Account,
    receipt: z.object({
      Action: z.object({
        signer_id: Account,
        actions: z.array(ActionSchema).max(64),
        output_data_receivers: z.array(z.object({ data_id: ChainHashSchema, receiver_id: Account })).max(16),
        input_data_ids: z.array(ChainHashSchema).max(16),
      }),
    }),
  })
  .transform((r) => ({
    id: r.receipt_id,
    predecessor: r.predecessor_id,
    receiver: r.receiver_id,
    signer: r.receipt.Action.signer_id,
    actions: r.receipt.Action.actions,
    outputReceivers: r.receipt.Action.output_data_receivers.map((o) => ({
      dataId: o.data_id,
      receiver: o.receiver_id,
    })),
    inputDataIds: r.receipt.Action.input_data_ids,
  }));
type Receipt = z.infer<typeof ReceiptSchema>;

const TxStatusSchema = z.object({
  final_execution_status: z.string(),
  status: StatusSchema,
  transaction: z.object({
    hash: ChainHashSchema,
    signer_id: Account,
    receiver_id: Account,
    actions: z.array(ActionSchema).max(64),
  }),
  transaction_outcome: OutcomeSchema,
  receipts_outcome: z.array(OutcomeSchema).max(256),
  receipts: z.array(z.unknown()).max(256),
});

const BlockSchema = z
  .object({
    header: z.object({
      hash: ChainHashSchema,
      prev_hash: ChainHashSchema,
      height: Int,
      timestamp_nanosec: Decimal,
    }),
  })
  .transform((b) => ({
    hash: b.header.hash,
    prevHash: b.header.prev_hash,
    height: b.header.height,
    timestampNs: b.header.timestamp_nanosec,
  }));
type Block = z.infer<typeof BlockSchema>;

const ViewAccountSchema = z.object({
  code_hash: ChainHashSchema,
  block_hash: ChainHashSchema,
});
const AccessKeyListSchema = z.object({
  block_hash: ChainHashSchema,
  keys: z
    .array(
      z.object({
        public_key: z.string().max(256),
        access_key: z.object({ nonce: Int, permission: z.unknown() }),
      }),
    )
    .max(256),
});
const CallResultSchema = z.object({
  result: z.array(z.number().int().min(0).max(255)).max(65_536),
  block_hash: ChainHashSchema,
});
const StatusRpcSchema = z.object({
  chain_id: z.string(),
  genesis_hash: z.string(),
  sync_info: z.object({ syncing: z.boolean() }),
});

// ---------------------------------------------------------------------------

const TRUE_BASE64 = 'dHJ1ZQ=='; // "true"
const FALSE_BASE64 = 'ZmFsc2U='; // "false"
const CALLBACK_METHOD = 'on_native_transfer_complete';

function parse<T>(schema: z.ZodType<T>, value: unknown, reason: VerificationFailure, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) fail(reason, `malformed ${what}`);
  return result.data;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Parses JSON call arguments strictly (duplicate keys rejected) and requires exactly `keys`. */
function exactArgs(base64: string, keys: ReadonlyArray<string>): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = parseStrictJson(decodeBase64(base64));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) return null;
  return record;
}

interface TaplyEvent {
  readonly event: string;
  readonly id: string;
  readonly termsHash: string;
  readonly status: string;
  readonly operationNonce: string;
}

const EventSchema = z.strictObject({
  standard: z.literal('taply'),
  version: z.literal('0.4.0'),
  event: z.string(),
  data: z
    .array(
      z.strictObject({
        id: z.string(),
        termsHash: z.string(),
        status: z.string(),
        revision: z.string(),
        operationNonce: z.string(),
      }),
    )
    .length(1),
});

/** Every `EVENT_JSON:` log in an outcome. A malformed Taply log fails closed. */
function eventsOf(outcome: Outcome): TaplyEvent[] {
  const events: TaplyEvent[] = [];
  for (const log of outcome.logs) {
    if (!log.startsWith('EVENT_JSON:')) continue;
    let value: unknown;
    try {
      value = parseStrictJson(log.slice('EVENT_JSON:'.length));
    } catch {
      fail('EVENT_MISMATCH', 'unparseable event log');
    }
    const parsed = EventSchema.safeParse(value);
    if (!parsed.success) fail('EVENT_MISMATCH', 'unexpected event shape');
    const [data] = parsed.data.data;
    if (data === undefined) fail('EVENT_MISMATCH', 'empty event');
    events.push({ event: parsed.data.event, ...data });
  }
  return events;
}

function expectEvent(
  outcome: Outcome,
  expected: {
    event: string;
    id: string;
    termsHash: string;
    status: string;
    nonce: string;
  },
): void {
  const events = eventsOf(outcome);
  check(events.length === 1, 'EVENT_MISMATCH', `expected one ${expected.event} event`);
  const [e] = events;
  check(
    e !== undefined &&
      e.event === expected.event &&
      e.id === expected.id &&
      e.termsHash === expected.termsHash &&
      e.status === expected.status &&
      e.operationNonce === expected.nonce,
    'EVENT_MISMATCH',
    `${expected.event} event disagrees`,
  );
}

// ---------------------------------------------------------------------------

interface Attempt {
  readonly tx: TxRef;
  readonly firstReceipt: { readonly outcome: Outcome };
  readonly transfer: { readonly receipt: Receipt; readonly outcome: Outcome };
  readonly callback: { readonly receipt: Receipt; readonly outcome: Outcome };
}

interface Context {
  readonly rpc: VerifierRpc;
  readonly contractId: string;
  readonly request: ContractRequest;
}

async function rpcCall(rpc: VerifierRpc, method: Parameters<VerifierRpc['call']>[0], params: unknown) {
  try {
    return await rpc.call(method, params);
  } catch (error) {
    if (error instanceof VerifierRpcError) {
      if (error.code === 'UNKNOWN_TRANSACTION') fail('TRANSACTION_NOT_FOUND', `${method} unknown transaction`);
      if (error.code === 'UNKNOWN_BLOCK') fail('HISTORY_UNAVAILABLE', `${method} block not available`);
      if (error.code === 'MALFORMED') fail('EVIDENCE_INCONSISTENT', `${method} malformed response`);
    }
    fail('RPC_UNAVAILABLE', `${method} failed`);
  }
}

/**
 * Reads one transaction at FINAL and checks one funding/retry attempt in it.
 * `kind` decides the top-level call it must contain; `nonce` is the operation
 * nonce the contract must have committed; `succeeded` whether this attempt is
 * the final, successful one.
 */
async function verifyAttempt(
  ctx: Context,
  tx: TxRef,
  kind: 'fund' | 'retry',
  nonce: bigint,
  succeeded: boolean,
): Promise<Attempt> {
  const { contractId, request } = ctx;
  const { terms } = request;
  const where = kind === 'fund' ? 'FUNDING_MISMATCH' : 'RETRY_MISMATCH';
  const raw = await rpcCall(ctx.rpc, 'EXPERIMENTAL_tx_status', {
    tx_hash: tx.hash,
    sender_account_id: tx.signerAccountId,
    wait_until: 'FINAL',
  });
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>)['final_execution_status'] !== 'FINAL'
  ) {
    fail('NOT_FINAL', `${kind} transaction not final`);
  }
  const value = parse(TxStatusSchema, raw, 'EVIDENCE_INCONSISTENT', `${kind} transaction`);
  check(value.final_execution_status === 'FINAL', 'NOT_FINAL', `${kind} transaction not final`);

  // --- The signed transaction itself.
  const t = value.transaction;
  check(t.hash === tx.hash, 'EVIDENCE_INCONSISTENT', 'transaction hash differs');
  check(t.signer_id === tx.signerAccountId, where, 'signer differs from reference');
  check(t.receiver_id === contractId, where, 'transaction not sent to the contract');
  const [call, ...extraActions] = t.actions;
  check(call !== undefined && extraActions.length === 0, where, 'transaction must contain exactly one action');
  check(call.kind === 'function_call', where, 'action is not a function call');
  if (kind === 'fund') {
    check(t.signer_id === request.payerAccountId, where, 'funding signer is not the recorded payer');
    check(
      terms.permittedPayerAccountId === null || terms.permittedPayerAccountId === t.signer_id,
      where,
      'funding signer violates payer restriction',
    );
    check(call.method === 'pay_instant_native', where, 'wrong funding method');
    check(call.deposit === terms.amountBaseUnits, where, 'attached deposit is not exactly the principal');
    const args = exactArgs(call.argsBase64, ['id', 'expectedTermsHash']);
    check(
      args !== null && args['id'] === terms.id && args['expectedTermsHash'] === request.termsHash,
      where,
      'funding arguments do not bind this request',
    );
  } else {
    check(t.signer_id === request.recipientAccountId, where, 'retry not signed by the recipient');
    check(call.method === 'retry_native_transfer', where, 'wrong retry method');
    check(call.deposit === '1', where, 'retry must attach exactly one yoctoNEAR');
    const args = exactArgs(call.argsBase64, ['id', 'expectedOperationNonce']);
    check(
      args !== null && args['id'] === terms.id && args['expectedOperationNonce'] === String(nonce - 1n),
      where,
      'retry arguments do not target the previous nonce',
    );
  }

  // --- Outcome graph: complete, rooted, final.
  const root = value.transaction_outcome;
  check(root.id === tx.hash && root.executor === tx.signerAccountId, 'EVIDENCE_INCONSISTENT', 'root outcome differs');
  const outcomes = new Map<string, Outcome>();
  for (const o of value.receipts_outcome) {
    check(!outcomes.has(o.id) && o.id !== root.id, 'EVIDENCE_INCONSISTENT', 'duplicate outcome');
    outcomes.set(o.id, o);
  }
  const visited = new Set<string>();
  const stack = [...root.receiptIds];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    check(!visited.has(id), 'EVIDENCE_INCONSISTENT', 'receipt graph is not a tree');
    visited.add(id);
    const o = outcomes.get(id);
    check(o !== undefined, 'EVIDENCE_INCOMPLETE', 'receipt outcome missing');
    check(o.status.kind !== 'unknown', 'NOT_FINAL', 'receipt outcome not executed');
    stack.push(...o.receiptIds);
  }
  check(visited.size === outcomes.size, 'EVIDENCE_INCONSISTENT', 'outcome outside the transaction graph');

  const receipts = new Map<string, Receipt>();
  for (const r of value.receipts) {
    const parsed = parse(ReceiptSchema, r, 'EVIDENCE_INCONSISTENT', 'receipt');
    check(!receipts.has(parsed.id), 'EVIDENCE_INCONSISTENT', 'duplicate receipt');
    receipts.set(parsed.id, parsed);
  }

  // --- First receipt: the transaction converted into a call on the contract.
  const [firstId, ...rootExtra] = root.receiptIds;
  check(
    firstId !== undefined && rootExtra.length === 0,
    'EVIDENCE_INCONSISTENT',
    'transaction must create one receipt',
  );
  const first = outcomes.get(firstId) as Outcome;
  const firstPayload = receipts.get(firstId);
  if (firstPayload !== undefined) {
    // Some nodes list it; if present it must be the same call (protocol-defined conversion).
    check(
      firstPayload.predecessor === tx.signerAccountId &&
        firstPayload.receiver === contractId &&
        firstPayload.signer === tx.signerAccountId &&
        JSON.stringify(firstPayload.actions) === JSON.stringify(t.actions),
      'EVIDENCE_INCONSISTENT',
      'first receipt differs from the signed transaction',
    );
  }
  check(first.executor === contractId, where, 'contract did not execute the call');

  // --- Its children: exactly one Transfer + one callback from the contract.
  // Anything else must be a protocol refund (predecessor "system", Transfer only).
  let transfer: Receipt | null = null;
  let callback: Receipt | null = null;
  for (const childId of first.receiptIds) {
    const child = receipts.get(childId);
    check(child !== undefined, 'EVIDENCE_INCOMPLETE', 'child receipt payload missing');
    if (child.predecessor === contractId) {
      const [action, ...more] = child.actions;
      check(
        action !== undefined && more.length === 0,
        'EVIDENCE_INCONSISTENT',
        'contract receipt with several actions',
      );
      if (action.kind === 'transfer') {
        check(transfer === null, 'TRANSFER_MISMATCH', 'more than one transfer scheduled');
        transfer = child;
      } else if (action.kind === 'function_call') {
        check(callback === null, 'CALLBACK_MISMATCH', 'more than one callback scheduled');
        callback = child;
      } else {
        fail('EVIDENCE_INCONSISTENT', 'unexpected contract action');
      }
    } else {
      check(isRefund(child, [tx.signerAccountId, contractId]), 'EVIDENCE_INCONSISTENT', 'unexpected child receipt');
    }
  }
  check(transfer !== null, 'TRANSFER_MISMATCH', 'no transfer scheduled');
  check(callback !== null, 'CALLBACK_MISMATCH', 'no callback scheduled');
  check(
    first.status.kind === 'receipt' && first.status.receiptId === callback.id,
    where,
    'call did not return the callback promise',
  );

  // --- Transfer: immutable recipient, exact principal, result wired to callback.
  const transferAction = transfer.actions[0] as Action;
  check(transfer.receiver === request.recipientAccountId, 'TRANSFER_MISMATCH', 'transfer not to the recipient');
  check(transfer.receiver === terms.creatorAccountId, 'TRANSFER_MISMATCH', 'recipient is not the creator');
  check(
    transferAction.kind === 'transfer' && transferAction.deposit === terms.amountBaseUnits,
    'TRANSFER_MISMATCH',
    'transfer amount is not the principal',
  );
  const [output, ...moreOutputs] = transfer.outputReceivers;
  check(
    output !== undefined && moreOutputs.length === 0 && output.receiver === contractId,
    'TRANSFER_MISMATCH',
    'transfer result not routed to the contract',
  );
  const transferOutcome = outcomes.get(transfer.id) as Outcome;
  check(transferOutcome.executor === request.recipientAccountId, 'TRANSFER_MISMATCH', 'transfer executed elsewhere');

  // --- Callback: private, this ID and nonce, consumes the transfer's result.
  const callbackAction = callback.actions[0] as Action;
  check(callback.receiver === contractId, 'CALLBACK_MISMATCH', 'callback not addressed to the contract');
  check(
    callbackAction.kind === 'function_call' &&
      callbackAction.method === CALLBACK_METHOD &&
      callbackAction.deposit === '0',
    'CALLBACK_MISMATCH',
    'wrong callback call',
  );
  const cbArgs = exactArgs(callbackAction.argsBase64, ['id', 'operationNonce', 'kind']);
  check(
    cbArgs !== null &&
      cbArgs['id'] === terms.id &&
      cbArgs['operationNonce'] === nonce.toString() &&
      cbArgs['kind'] === 'INSTANT_PAYOUT',
    'CALLBACK_MISMATCH',
    'callback arguments do not match',
  );
  check(
    callback.inputDataIds.length === 1 && callback.inputDataIds[0] === output.dataId,
    'CALLBACK_MISMATCH',
    'callback does not consume the transfer result',
  );
  const callbackOutcome = outcomes.get(callback.id) as Outcome;
  check(callbackOutcome.executor === contractId, 'CALLBACK_MISMATCH', 'callback executed elsewhere');

  // Only refunds may descend from the transfer or the callback.
  for (const id of [...transferOutcome.receiptIds, ...callbackOutcome.receiptIds]) {
    const child = receipts.get(id);
    check(
      child !== undefined && isRefund(child, [tx.signerAccountId, contractId]),
      'EVIDENCE_INCONSISTENT',
      'unexpected receipt after payout',
    );
  }

  // --- Results.
  expectEvent(first, {
    event: 'payout_started',
    id: terms.id,
    termsHash: request.termsHash,
    status: 'PAYOUT_IN_FLIGHT',
    nonce: nonce.toString(),
  });
  if (succeeded) {
    check(
      transferOutcome.status.kind === 'value' && transferOutcome.status.base64 === '',
      'TRANSFER_MISMATCH',
      'transfer did not succeed',
    );
    check(
      callbackOutcome.status.kind === 'value' && callbackOutcome.status.base64 === TRUE_BASE64,
      'CALLBACK_MISMATCH',
      'callback did not confirm the payout',
    );
    check(
      value.status.kind === 'value' && value.status.base64 === TRUE_BASE64,
      'CALLBACK_MISMATCH',
      'transaction result is not true',
    );
    expectEvent(callbackOutcome, {
      event: 'payout_succeeded',
      id: terms.id,
      termsHash: request.termsHash,
      status: 'FINAL_PAID',
      nonce: nonce.toString(),
    });
  } else {
    // An earlier attempt must be a RECORDED failure; otherwise a retry would mean
    // the principal may have been sent twice.
    check(transferOutcome.status.kind === 'failure', 'EVIDENCE_INCONSISTENT', 'earlier transfer did not fail');
    check(
      callbackOutcome.status.kind === 'value' && callbackOutcome.status.base64 === FALSE_BASE64,
      'EVIDENCE_INCONSISTENT',
      'earlier failure was not recorded',
    );
    expectEvent(callbackOutcome, {
      event: 'payout_failed',
      id: terms.id,
      termsHash: request.termsHash,
      status: 'PAYOUT_FAILED_RECOVERABLE',
      nonce: nonce.toString(),
    });
  }

  return {
    tx,
    firstReceipt: { outcome: first },
    transfer: { receipt: transfer, outcome: transferOutcome },
    callback: { receipt: callback, outcome: callbackOutcome },
  };
}

function isRefund(receipt: Receipt, allowedReceivers: ReadonlyArray<string>): boolean {
  return (
    receipt.predecessor === 'system' &&
    allowedReceivers.includes(receipt.receiver) &&
    receipt.actions.length === 1 &&
    receipt.actions[0]?.kind === 'transfer'
  );
}

async function readBlock(rpc: VerifierRpc, hash: string): Promise<Block> {
  const block = parse(BlockSchema, await rpcCall(rpc, 'block', { block_id: hash }), 'EVIDENCE_INCONSISTENT', 'block');
  check(block.hash === hash, 'EVIDENCE_INCONSISTENT', 'block hash differs');
  return block;
}

async function codeHashAt(rpc: VerifierRpc, accountId: string, blockHash: string): Promise<string> {
  const raw = await rpcCall(rpc, 'query', {
    request_type: 'view_account',
    account_id: accountId,
    block_id: blockHash,
  });
  const view = parse(ViewAccountSchema, raw, 'EVIDENCE_INCONSISTENT', 'view_account');
  check(view.block_hash === blockHash, 'EVIDENCE_INCONSISTENT', 'view_account not anchored');
  return view.code_hash;
}

async function accessKeysAt(rpc: VerifierRpc, accountId: string, blockHash: string): Promise<string> {
  const raw = await rpcCall(rpc, 'query', {
    request_type: 'view_access_key_list',
    account_id: accountId,
    block_id: blockHash,
  });
  const list = parse(AccessKeyListSchema, raw, 'EVIDENCE_INCONSISTENT', 'view_access_key_list');
  check(list.block_hash === blockHash, 'EVIDENCE_INCONSISTENT', 'access key list not anchored');
  const keys = list.keys
    .map((k) => `${k.public_key}|${k.access_key.nonce}|${JSON.stringify(k.access_key.permission)}`)
    .sort();
  return JSON.stringify(keys);
}

function toBlockRef(block: Block): BlockRef {
  return {
    hash: block.hash,
    height: block.height,
    timestampNs: block.timestampNs,
  };
}

function notAfter(a: Block, b: Block): boolean {
  return BigInt(a.height) <= BigInt(b.height) && BigInt(a.timestampNs) <= BigInt(b.timestampNs);
}

export async function verifyInstantReceipt(input: VerifyInstantInput): Promise<VerificationResult> {
  try {
    return { kind: 'verified', receipt: await verify(input) };
  } catch (error) {
    if (error instanceof Fail) {
      return {
        kind: 'not_verified',
        reason: error.reason,
        detail: error.detail,
        transient: TRANSIENT_FAILURES.has(error.reason),
      };
    }
    return {
      kind: 'not_verified',
      reason: 'EVIDENCE_INCONSISTENT',
      detail: 'unexpected verifier error',
      transient: false,
    };
  }
}

async function verify(input: VerifyInstantInput): Promise<VerifiedReceipt> {
  const { rpc, contractId, approvedCodeHash, requestId } = input;
  const refs = [input.fundingTransaction, ...input.retryTransactions];
  check(AccountIdSchema.safeParse(contractId).success, 'INPUT_INVALID', 'contract id');
  check(ChainHashSchema.safeParse(approvedCodeHash).success, 'INPUT_INVALID', 'code hash');
  check(HashHexSchema.safeParse(requestId).success, 'INPUT_INVALID', 'request id');
  for (const ref of refs) {
    check(
      ChainHashSchema.safeParse(ref.hash).success && AccountIdSchema.safeParse(ref.signerAccountId).success,
      'INPUT_INVALID',
      'transaction reference',
    );
  }
  check(new Set(refs.map((r) => r.hash)).size === refs.length, 'INPUT_INVALID', 'repeated transaction');

  // 1. Network.
  const status = parse(StatusRpcSchema, await rpcCall(rpc, 'status', []), 'EVIDENCE_INCONSISTENT', 'status');
  check(
    status.chain_id === 'testnet' && status.genesis_hash === TESTNET_GENESIS_HASH,
    'NETWORK_MISMATCH',
    'not testnet',
  );
  check(!status.sync_info.syncing, 'RPC_UNAVAILABLE', 'node syncing');

  // 2. Contract state at the latest final block, approved code.
  const finalRaw = await rpcCall(rpc, 'block', { finality: 'final' });
  const stateBlock = parse(BlockSchema, finalRaw, 'EVIDENCE_INCONSISTENT', 'final block');
  check(
    (await codeHashAt(rpc, contractId, stateBlock.hash)) === approvedCodeHash,
    'CODE_HASH_MISMATCH',
    'at state block',
  );
  const argsJson = JSON.stringify({ id: requestId });
  const call = parse(
    CallResultSchema,
    await rpcCall(rpc, 'query', {
      request_type: 'call_function',
      account_id: contractId,
      method_name: 'get_request',
      args_base64: btoa(argsJson),
      block_id: stateBlock.hash,
    }),
    'EVIDENCE_INCONSISTENT',
    'get_request',
  );
  check(call.block_hash === stateBlock.hash, 'EVIDENCE_INCONSISTENT', 'get_request not anchored');
  let stateValue: unknown;
  try {
    stateValue = parseStrictJson(Uint8Array.from(call.result));
  } catch {
    fail('STATE_INVALID', 'get_request result not strict JSON');
  }
  check(stateValue !== null, 'REQUEST_NOT_FOUND', 'unknown request');
  const request = parse(ContractRequestSchema, stateValue, 'STATE_INVALID', 'request');
  const { terms } = request;
  check(terms.id === requestId && terms.contractId === contractId, 'STATE_INVALID', 'request identity');
  check(calculateTermsHash(terms) === request.termsHash, 'STATE_INVALID', 'terms hash does not recompute');
  check(
    calculateRequestId({
      contractId: terms.contractId,
      creationNonce: terms.creationNonce,
      creatorAccountId: terms.creatorAccountId,
      network: terms.network,
    }) === terms.id,
    'STATE_INVALID',
    'request id does not recompute',
  );
  check(terms.mode === 'instant' && terms.assetId === 'near:native', 'STATE_INVALID', 'not native instant');
  check(request.recipientAccountId === terms.creatorAccountId, 'STATE_INVALID', 'recipient is not creator');
  check(request.status === 'FINAL_PAID', 'NOT_FINAL_PAID', `contract reports ${request.status}`);
  const op = request.latestOperation;
  check(
    op !== null &&
      op.status === 'SUCCEEDED' &&
      op.kind === 'INSTANT_PAYOUT' &&
      op.destinationAccountId === request.recipientAccountId &&
      op.amountBaseUnits === terms.amountBaseUnits &&
      op.resolvedAtNs !== null &&
      request.payerAccountId !== null &&
      request.fundedAtNs !== null &&
      request.settlementBranch === 'RECIPIENT',
    'STATE_INVALID',
    'final operation incomplete',
  );
  const finalNonce = BigInt(op.nonce);
  check(finalNonce >= 1n, 'STATE_INVALID', 'nonce');
  const expectedRetries = finalNonce - 1n;
  const givenRetries = BigInt(input.retryTransactions.length);
  check(givenRetries <= expectedRetries, 'EVIDENCE_INCONSISTENT', 'more retries supplied than the contract recorded');
  check(givenRetries === expectedRetries, 'EVIDENCE_INCOMPLETE', 'retry transaction reference missing');
  check(input.fundingTransaction.signerAccountId === request.payerAccountId, 'FUNDING_MISMATCH', 'funding signer');

  // 3-7. Each attempt, in order.
  const ctx: Context = { rpc, contractId, request };
  const attempts: Attempt[] = [];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i] as TxRef;
    const nonce = BigInt(i + 1);
    attempts.push(await verifyAttempt(ctx, ref, i === 0 ? 'fund' : 'retry', nonce, nonce === finalNonce));
  }
  const funding = attempts[0] as Attempt;
  const last = attempts[attempts.length - 1] as Attempt;

  // 8. Chain time and ordering.
  const blocks = new Map<string, Block>();
  const blockOf = async (hash: string) => {
    const known = blocks.get(hash);
    if (known !== undefined) return known;
    const block = await readBlock(rpc, hash);
    check(notAfter(block, stateBlock), 'TIMING_MISMATCH', 'receipt after state block');
    blocks.set(hash, block);
    return block;
  };
  let previous: Block | null = null;
  for (const attempt of attempts) {
    const first = await blockOf(attempt.firstReceipt.outcome.blockHash);
    const transfer = await blockOf(attempt.transfer.outcome.blockHash);
    const callback = await blockOf(attempt.callback.outcome.blockHash);
    check(previous === null || notAfter(previous, first), 'TIMING_MISMATCH', 'attempts out of order');
    check(notAfter(first, transfer) && notAfter(transfer, callback), 'TIMING_MISMATCH', 'receipts out of order');
    previous = callback;
  }
  const fundingBlock = await blockOf(funding.firstReceipt.outcome.blockHash);
  const startBlock = await blockOf(last.firstReceipt.outcome.blockHash);
  const transferBlock = await blockOf(last.transfer.outcome.blockHash);
  const callbackBlock = await blockOf(last.callback.outcome.blockHash);
  check(request.fundedAtNs === fundingBlock.timestampNs, 'TIMING_MISMATCH', 'fundedAtNs is not the funding block time');
  check(op.startedAtNs === startBlock.timestampNs, 'TIMING_MISMATCH', 'startedAtNs is not the payout block time');
  check(
    op.resolvedAtNs === callbackBlock.timestampNs,
    'TIMING_MISMATCH',
    'resolvedAtNs is not the callback block time',
  );

  // 9. Approved code wherever contract code ran.
  const codeBlocks = new Set<string>();
  for (const attempt of attempts) {
    codeBlocks.add(attempt.firstReceipt.outcome.blockHash);
    codeBlocks.add(attempt.callback.outcome.blockHash);
  }
  for (const hash of codeBlocks) {
    check((await codeHashAt(rpc, contractId, hash)) === approvedCodeHash, 'CODE_HASH_MISMATCH', 'at a receipt block');
  }

  // 10. No contract-account transaction from before funding to the state block.
  const keysBefore = await accessKeysAt(rpc, contractId, fundingBlock.prevHash);
  const keysAfter = await accessKeysAt(rpc, contractId, stateBlock.hash);
  check(keysBefore === keysAfter, 'CONTRACT_ACCOUNT_ACTIVITY', 'contract access keys changed during the payment');

  // The shared schema checks shape and its own consistency rules once more.
  const candidate: VerifiedReceipt = {
    schemaVersion: 'taply.receipt.v1',
    requestId,
    termsHash: request.termsHash,
    sessionId: null,
    network: 'near-testnet',
    contractId,
    contractCodeHash: approvedCodeHash,
    mode: 'instant',
    finalStatus: 'FINAL_PAID',
    payerAccountId: request.payerAccountId,
    recipientAccountId: request.recipientAccountId,
    settlementBeneficiaryAccountId: request.recipientAccountId,
    assetId: 'near:native',
    amountBaseUnits: terms.amountBaseUnits,
    operationNonce: op.nonce,
    fundingTransaction: {
      hash: funding.tx.hash,
      signerAccountId: funding.tx.signerAccountId,
    },
    fundingReceipt: {
      receiptId: funding.firstReceipt.outcome.id,
      executorAccountId: contractId,
      block: toBlockRef(fundingBlock),
      outcome: 'SUCCESS',
    },
    settlementTransaction: {
      hash: last.tx.hash,
      signerAccountId: last.tx.signerAccountId,
    },
    transferReceipt: {
      receiptId: last.transfer.outcome.id,
      executorAccountId: request.recipientAccountId,
      block: toBlockRef(transferBlock),
      outcome: 'SUCCESS',
    },
    callbackReceipt: {
      receiptId: last.callback.outcome.id,
      executorAccountId: contractId,
      block: toBlockRef(callbackBlock),
      outcome: 'SUCCESS',
    },
    contractStateBlock: toBlockRef(stateBlock),
    verification: {
      state: 'verified_final',
      executionFinality: 'FINAL',
      trustModel: 'configured-rpc',
      rpcProviderId: rpc.providerId,
      checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    },
  };
  const parsed = VerifiedReceiptSchema.safeParse(candidate);
  if (!parsed.success) fail('RECEIPT_SCHEMA_REJECTED', 'shared VerifiedReceiptSchema refused the receipt');
  return parsed.data;
}
