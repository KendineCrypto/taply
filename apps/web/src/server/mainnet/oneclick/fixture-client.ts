import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { quoteHashSdk } from './sdk';
import type { OneClickQuoteResponse } from './sdk';
import type { OneClickClient } from './client';

/**
 * SYNTHETIC 1Click responses — clearly identified test fixtures.
 *
 * Shape: the SDK 0.1.26 `QuoteResponse` type. Numbers: the dry quote recorded
 * in docs/MAINNET_BRIEF.md §3 (1.000000 USDC out of NEAR needed 1.010309 USDC
 * in from Base, estimate 35 s). Signature: produced with an EPHEMERAL ed25519
 * key generated per process, over the SDK's own `quoteHash`, so verification
 * runs the real SDK code path. The production manager key is never involved,
 * so a fixture response can never pass production verification.
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET.charAt(Number.parseInt((n % 58n).toString(), 10)) + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export interface FixtureSigner {
  readonly publicKey: string;
  signResponse(response: Omit<OneClickQuoteResponse, 'signature'>): OneClickQuoteResponse;
}

export function createFixtureSigner(): FixtureSigner {
  const { publicKey, privateKey }: { publicKey: KeyObject; privateKey: KeyObject } = generateKeyPairSync('ed25519');
  const raw = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })).slice(-32);
  return {
    publicKey: `ed25519:${base58(raw)}`,
    signResponse(response) {
      const unsigned = { ...response, signature: '' } as OneClickQuoteResponse;
      const message = new TextEncoder().encode(quoteHashSdk(unsigned));
      return { ...unsigned, signature: `ed25519:${base58(new Uint8Array(sign(null, message, privateKey)))}` };
    },
  };
}

/** 1.010309 USDC in per 1.000000 USDC out (brief §3), rounded up to a base unit. */
export function fixtureAmountIn(amountOut: string): string {
  return ((BigInt(amountOut) * 1_010_309n + 999_999n) / 1_000_000n).toString();
}

const usdc = (base: string) => {
  const v = base.padStart(7, '0');
  return `${v.slice(0, -6)}.${v.slice(-6)}`.replace(/\.?0+$/, '') || '0';
};

/** Builds the unsigned response 1Click would return for `body` (dry: no deposit address). */
export function fixtureQuoteResponse(body: Record<string, unknown>, nowMs: number): Omit<OneClickQuoteResponse, 'signature'> {
  const amountOut = String(body['amount']);
  const amountIn = fixtureAmountIn(amountOut);
  return {
    correlationId: randomUUID(),
    timestamp: new Date(nowMs).toISOString(),
    quoteRequest: body as unknown as OneClickQuoteResponse['quoteRequest'],
    quote: {
      amountIn,
      amountInFormatted: usdc(amountIn),
      amountInUsd: usdc(amountIn),
      minAmountIn: amountIn,
      amountOut,
      amountOutFormatted: usdc(amountOut),
      amountOutUsd: usdc(amountOut),
      minAmountOut: amountOut,
      timeEstimate: 35,
    },
  };
}

/** Fixture client: signs every quote with the ephemeral key. Status/tokens are not used in fixture mode. */
export function createFixtureClient(signer: FixtureSigner, now: () => number = Date.now): OneClickClient {
  return {
    async quote(body) {
      return signer.signResponse(fixtureQuoteResponse(body as Record<string, unknown>, now()));
    },
    async status() {
      throw new Error('FIXTURE_STATUS_NOT_RECORDED');
    },
    async tokens() {
      return [];
    },
  };
}
