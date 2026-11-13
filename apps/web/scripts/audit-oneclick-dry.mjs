// Public API observation ONLY. Fixed dry:true; no funding address requested,
// no wallet/signing/broadcast API, and no API credential read from environment.
import { writeFileSync } from 'node:fs';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
const output = process.argv[2];
if (!output) throw new Error('Output JSON path required');
const request = {
  dry: true, swapType: 'EXACT_OUTPUT', slippageTolerance: 100,
  originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', depositType: 'ORIGIN_CHAIN',
  destinationAsset: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', amount: '1000000',
  refundTo: '0x1111111111111111111111111111111111111111', refundType: 'ORIGIN_CHAIN',
  recipient: 'devkendinecrypto.near', recipientType: 'DESTINATION_CHAIN',
  deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
  customRecipientMsg: JSON.stringify({ id: 'a'.repeat(64), expectedTermsHash: 'b'.repeat(64), action: 'pay_instant' }),
};
let result;
try {
  const response = await fetch('https://1click.chaindefuser.com/v0/quote', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let body; try { body = JSON.parse(raw); } catch { body = raw.slice(0, 1000); }
  result = { status: response.status, body,
    signatureVerifiedByPinnedSdk: response.ok && typeof body === 'object' && body !== null && verifyQuoteSignature(body),
  };
} catch (error) { result = { error: error.message, signatureVerifiedByPinnedSdk: false }; }
const report = { kind: 'LIVE_DRY_API_PROBE_NOT_TAPLY_PAYMENT', observedAt: new Date().toISOString(),
  syntheticRequestIdAndRefundAddress: true, deployedTaplyContractVerified: false, request, ...result };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
