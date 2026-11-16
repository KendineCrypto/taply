// Live DRY quote evidence (dry:true is hard-coded: no deposit address exists, nothing can be funded).
// Uses Taply's own quote builder, bounded HTTP client and SDK signature verification against the
// production 1Click manager key. Synthetic request id / terms hash; recipient is the given contract.
// Run from apps/web (behind an HTTPS proxy add NODE_USE_ENV_PROXY=1):
//   node scripts/oneclick-live-dry.mjs <outdir> '{"requestId":"<64 hex>","termsHash":"<64 hex>","amount":"500000",
//     "refundTo":"<EIP-55 address>","contractId":"taply-pay.kendinecrypto.near"}'
// Output: <outdir>/live-dry-quote.json (docs/evidence/mainnet-1click-2026-11-16/).
import { buildQuoteRequest } from '@/server/mainnet/oneclick/quote-request';
import { createOneClickClient } from '@/server/mainnet/oneclick/client';
import { verifyQuoteResponse, MANAGER_PUBLIC_KEY } from '@/server/mainnet/oneclick/verify';
import { BASE_USDC } from '@/lib/mainnet/oneclick/allowlist';

export async function run(input: { requestId: string; termsHash: string; amount: string; refundTo: string; contractId: string }) {
  const client = createOneClickClient({ apiKey: process.env['TAPLY_ONECLICK_API_KEY'] });
  const now = Date.now();
  const sent = buildQuoteRequest({ dry: true, origin: BASE_USDC, refundTo: input.refundTo, contractId: input.contractId,
    requestId: input.requestId, termsHash: input.termsHash, amountBaseUnits: input.amount, deadlineMs: now + 20 * 60_000 });
  const tokens = await client.tokens();
  let raw: unknown; let error: string | null = null;
  try { raw = await client.quote(sent); } catch (e) { error = e instanceof Error ? `${e.name}: ${(e as { code?: string }).code ?? e.message}` : String(e); }
  const checked = raw === undefined ? null : verifyQuoteResponse(raw, sent, { nowMs: Date.now(), requestExpiresAtMs: now + 60 * 60_000, managerPublicKey: MANAGER_PUBLIC_KEY });
  return { at: new Date(now).toISOString(), managerKey: MANAGER_PUBLIC_KEY, sent, tokenCount: Array.isArray(tokens) ? tokens.length : null, raw, error, verification: checked === null ? null : checked.ok ? { ok: true } : { ok: false, code: checked.code } };
}
