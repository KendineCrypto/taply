import { z } from 'zod';
import { MAINNET_USDC, MainnetAccountSchema, U128Schema, parseStrictJson } from '@taply/shared';
import type { MainnetReadProfile, MainnetWalletSnapshot } from '@taply/near-client';

/**
 * Read-only USDC transfer evidence for `prepareMainnetUsdcTransfer`: sender
 * balance and both storage registrations, read at the snapshot's own block
 * (`block_id = snapshot.blockHash`) so token evidence and the spending snapshot
 * describe one chain state. Any answer from another block is refused.
 *
 * API change request (Codex): near-client exports no token-evidence reader;
 * replace this with a canonical one when delivered. This module never signs.
 */
export interface UsdcTransferEvidence {
  readonly blockHash: string;
  readonly accountId: string;
  readonly receiverId: string;
  readonly balance: string;
  readonly senderRegistered: boolean;
  readonly receiverRegistered: boolean;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const MAX_BYTES = 65536;

export class UsdcEvidenceError extends Error {
  constructor(readonly code: 'EVIDENCE_MISMATCH' | 'RPC_UNAVAILABLE' | 'MALFORMED') { super(code); }
}

const Envelope = z.object({ jsonrpc: z.literal('2.0'), id: z.string(), error: z.unknown().optional(),
  result: z.object({ result: z.array(z.number().int().min(0).max(255)).max(MAX_BYTES), block_hash: z.string() }).optional() });
const StorageBalance = z.union([z.null(), z.object({ total: U128Schema, available: U128Schema })]);

async function callView(profile: MainnetReadProfile, fetcher: Fetcher, blockHash: string, method: string, args: object, id: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let text: string;
  try {
    const res = await fetcher(profile.rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'query', params: {
        request_type: 'call_function', account_id: MAINNET_USDC, method_name: method,
        args_base64: btoa(JSON.stringify(args)), block_id: blockHash } }),
      signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (!res.ok) throw new UsdcEvidenceError('RPC_UNAVAILABLE');
    text = await res.text();
  } catch (e) {
    if (e instanceof UsdcEvidenceError) throw e;
    throw new UsdcEvidenceError('RPC_UNAVAILABLE');
  } finally { clearTimeout(timer); }
  if (text.length > MAX_BYTES) throw new UsdcEvidenceError('MALFORMED');
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new UsdcEvidenceError('MALFORMED'); }
  const env = Envelope.safeParse(body);
  if (!env.success || env.data.id !== id) throw new UsdcEvidenceError('MALFORMED');
  if (env.data.error !== undefined) throw new UsdcEvidenceError('RPC_UNAVAILABLE');
  const r = env.data.result;
  if (r === undefined) throw new UsdcEvidenceError('MALFORMED');
  if (r.block_hash !== blockHash) throw new UsdcEvidenceError('EVIDENCE_MISMATCH');
  try { return parseStrictJson(new Uint8Array(r.result)); } catch { throw new UsdcEvidenceError('MALFORMED'); }
}

function registered(v: unknown): boolean {
  const parsed = StorageBalance.safeParse(v);
  if (!parsed.success) throw new UsdcEvidenceError('MALFORMED');
  return parsed.data !== null;
}

export async function readUsdcTransferEvidence(
  profile: MainnetReadProfile, snapshot: MainnetWalletSnapshot, receiverId: string,
  fetcher: Fetcher = (url, init) => globalThis.fetch(url, init),
): Promise<UsdcTransferEvidence> {
  const receiver = MainnetAccountSchema.parse(receiverId);
  const b = snapshot.blockHash;
  const [balance, sender, recv] = await Promise.all([
    callView(profile, fetcher, b, 'ft_balance_of', { account_id: snapshot.accountId }, 'taply-usdc-1'),
    callView(profile, fetcher, b, 'storage_balance_of', { account_id: snapshot.accountId }, 'taply-usdc-2'),
    callView(profile, fetcher, b, 'storage_balance_of', { account_id: receiver }, 'taply-usdc-3'),
  ]);
  const parsed = U128Schema.safeParse(balance);
  if (!parsed.success) throw new UsdcEvidenceError('MALFORMED');
  return Object.freeze({ blockHash: b, accountId: snapshot.accountId, receiverId: receiver, balance: parsed.data,
    senderRegistered: registered(sender), receiverRegistered: registered(recv) });
}
