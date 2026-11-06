import { describe, expect, it } from 'vitest';
import { ContractRequestSchema } from '@/lib/protocol';
import { locateFundingTransaction } from '../locate-funding';
import { createFetchLocatorRpc } from '../rpc';

/**
 * OPT-IN, read-only, real NEAR Testnet: skipped unless TAPLY_LIVE_RPC is set to
 * an HTTPS RPC that still holds the 2026-11-01 pilot blocks (an archival RPC,
 * e.g. https://archival-rpc.testnet.near.org). Never runs in `pnpm check`.
 *
 *   TAPLY_LIVE_RPC=https://archival-rpc.testnet.near.org \
 *     pnpm --filter @taply/web exec vitest run src/lib/verify/__tests__/locate-funding.live.test.ts
 *
 * Expected: the locator finds exactly the pilot funding transaction recorded in
 * docs/EVIDENCE.md, from the contract's `fundedAtNs` alone. Only `block`,
 * `chunk` and one `call_function get_request` view are used; nothing is signed.
 */

const RPC = process.env['TAPLY_LIVE_RPC'];
const CONTRACT = 'taply-pay-pilot-1.testnet';
const ID = '9b9a572416f7480cddb3f8936ef2f3c77196c4157c5cb35e2830e1769b7c4502';
const FUNDING = 'CrzQ57JxC6ZtGWBYcYFq5Y92J3V6dgf2jKC64AnyQ9Su';

describe.skipIf(RPC === undefined)('live Testnet: locate the pilot funding transaction', () => {
  it('finds CrzQ57Jx… from the contract state and public blocks only', { timeout: 120_000 }, async () => {
    const url = RPC ?? '';
    const view = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query',
        params: { request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: 'get_request', args_base64: btoa(JSON.stringify({ id: ID })) },
      }),
    }).then((r) => r.json() as Promise<{ result: { result: number[] } }>);
    const request = ContractRequestSchema.parse(JSON.parse(new TextDecoder().decode(new Uint8Array(view.result.result))));
    const result = await locateFundingTransaction({
      rpc: createFetchLocatorRpc({ rpcUrl: url, providerId: 'live', timeoutMs: 30_000 }),
      contractId: CONTRACT,
      request,
    });
    console.info('[live locator]', JSON.stringify(result));
    expect(result).toMatchObject({ kind: 'found', candidates: [FUNDING] });
  });
});
