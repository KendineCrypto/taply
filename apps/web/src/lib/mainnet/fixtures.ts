import {
  MAINNET_USDC_ASSET,
  MainnetRequestSchema,
  calculateMainnetRequestId,
  calculateMainnetTermsHash,
} from '@taply/shared';
import { bindMainnetCommerceTerms } from '@taply/near-client';
import type { MainnetCommerceSession } from '@taply/near-client';
import type { MainnetIntentTerms } from '@taply/shared';
import type { z } from 'zod';
import type { ContractStatus, OneClickStatus } from './status';

/**
 * FIXTURE DATA — NOT ON CHAIN.
 *
 * Controlled mainnet request scenarios for UI development, tests and browser
 * QA while no mainnet contract is deployed (owner NO-GO 2026-11-13). Every
 * object is a schema-valid `MainnetRequest` built with Codex's exported
 * id/hash functions against the STAGING contract id, so the UI exercises the
 * real types. The merchant name is deliberately fake. Served only when
 * NEXT_PUBLIC_TAPLY_MAINNET_FIXTURES=on (refused on Production by
 * scripts/check-mainnet-env.mjs) and labelled FIXTURE on every screen.
 */

export type MainnetRequest = z.infer<typeof MainnetRequestSchema>;

export const FIXTURE_CONTRACT = 'devkendinecrypto.near' as const;
export const FIXTURE_MERCHANT = 'taply-fixture-merchant.near';
export const ROUTER = 'intents.near';

export interface FixtureScenario {
  readonly name: string;
  readonly asset: 'USDC' | 'NEAR';
  readonly amountBaseUnits: string;
  readonly status: ContractStatus;
  readonly oneClick: OneClickStatus | null;
  /** Minutes the payout has been in flight (R-2 scenarios). */
  readonly inFlightMinutes?: number;
  readonly memo: string;
}

export const FIXTURE_SCENARIOS: ReadonlyArray<FixtureScenario> = [
  { name: 'usdc-awaiting', asset: 'USDC', amountBaseUnits: '12500000', status: 'OPEN', oneClick: null, memo: 'Table 4' },
  { name: 'usdc-deposit-seen', asset: 'USDC', amountBaseUnits: '4200000', status: 'OPEN', oneClick: 'KNOWN_DEPOSIT_TX', memo: '' },
  { name: 'usdc-processing', asset: 'USDC', amountBaseUnits: '7000000', status: 'OPEN', oneClick: 'PROCESSING', memo: '' },
  { name: 'usdc-success-unsettled', asset: 'USDC', amountBaseUnits: '3000000', status: 'OPEN', oneClick: 'SUCCESS', memo: '' },
  { name: 'usdc-recorded', asset: 'USDC', amountBaseUnits: '9990000', status: 'FINAL_PAID', oneClick: 'SUCCESS', memo: 'Order 118' },
  { name: 'usdc-refunded', asset: 'USDC', amountBaseUnits: '5000000', status: 'OPEN', oneClick: 'REFUNDED', memo: '' },
  { name: 'usdc-failed', asset: 'USDC', amountBaseUnits: '6000000', status: 'OPEN', oneClick: 'FAILED', memo: '' },
  { name: 'usdc-incomplete', asset: 'USDC', amountBaseUnits: '8000000', status: 'OPEN', oneClick: 'INCOMPLETE_DEPOSIT', memo: '' },
  { name: 'usdc-r2-unknown', asset: 'USDC', amountBaseUnits: '2500000', status: 'PAYOUT_IN_FLIGHT', oneClick: 'SUCCESS', inFlightMinutes: 45, memo: '' },
  { name: 'usdc-payout-failed', asset: 'USDC', amountBaseUnits: '1500000', status: 'PAYOUT_FAILED_RECOVERABLE', oneClick: 'SUCCESS', memo: '' },
  { name: 'usdc-cancelled', asset: 'USDC', amountBaseUnits: '2000000', status: 'CANCELLED_UNFUNDED', oneClick: null, memo: '' },
  { name: 'usdc-too-small', asset: 'USDC', amountBaseUnits: '100000', status: 'OPEN', oneClick: null, memo: '' },
  { name: 'native-awaiting', asset: 'NEAR', amountBaseUnits: '250000000000000000000000', status: 'OPEN', oneClick: null, memo: 'Coffee' },
];

const HOUR_MS = 3_600_000;
const NS = 1_000_000n;

/** ASCII name, hex, right-padded to 32 bytes: deterministic and obviously synthetic. */
export function fixtureNonce(name: string): string {
  const hex = Array.from(new TextEncoder().encode(name), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length > 64) throw new Error('FIXTURE_NAME_TOO_LONG');
  return hex.padEnd(64, '0');
}

/**
 * Builds one schema-valid fixture request. Times are anchored to the current
 * hour so the server and the browser derive identical terms hashes.
 */
export function buildFixtureRequest(scenario: FixtureScenario, nowMs: number): MainnetRequest {
  const anchorMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const createdAtNs = BigInt(anchorMs - HOUR_MS) * NS;
  const fundingExpiresAtNs = createdAtNs + 23n * BigInt(HOUR_MS) * NS;
  const creationNonce = fixtureNonce(scenario.name);
  const id = calculateMainnetRequestId({
    contractId: FIXTURE_CONTRACT,
    creationNonce,
    creatorAccountId: FIXTURE_MERCHANT,
    network: 'near-mainnet',
  });
  const terms: MainnetIntentTerms = {
    schemaVersion: 'taply.intent.v1',
    id,
    network: 'near-mainnet',
    contractId: FIXTURE_CONTRACT,
    creationNonce,
    creatorAccountId: FIXTURE_MERCHANT,
    assetId: scenario.asset === 'USDC' ? MAINNET_USDC_ASSET : 'near:native',
    amountBaseUnits: scenario.amountBaseUnits,
    mode: 'instant',
    cancelDurationNs: null,
    fundingExpiresAtNs: fundingExpiresAtNs.toString(),
    permittedPayerAccountId: null,
    merchantAccountId: null,
    memo: scenario.memo,
    sessionBinding: null,
  };
  const termsHash = calculateMainnetTermsHash(terms);
  const funded = scenario.status !== 'OPEN' && scenario.status !== 'CANCELLED_UNFUNDED';
  const fundedAtNs = BigInt(nowMs - (scenario.inFlightMinutes ?? 2) * 60_000) * NS;
  const opStatus = scenario.status === 'FINAL_PAID' ? 'SUCCEEDED' : scenario.status === 'PAYOUT_IN_FLIGHT' ? 'IN_FLIGHT' : 'FAILED';
  const request = {
    terms,
    termsHash,
    sessionCommitment: null,
    recipientAccountId: FIXTURE_MERCHANT,
    status: scenario.status,
    revision: funded ? '3' : scenario.status === 'CANCELLED_UNFUNDED' ? '2' : '1',
    createdAtNs: createdAtNs.toString(),
    payerAccountId: funded ? (scenario.asset === 'USDC' ? ROUTER : 'taply-fixture-payer.near') : null,
    fundedAtNs: funded ? fundedAtNs.toString() : null,
    cancelUntilNs: null,
    settlementBranch: funded ? ('RECIPIENT' as const) : null,
    latestOperation: funded
      ? {
          nonce: '1',
          kind: 'INSTANT_PAYOUT' as const,
          destinationAccountId: FIXTURE_MERCHANT,
          amountBaseUnits: scenario.amountBaseUnits,
          status: opStatus,
          startedAtNs: fundedAtNs.toString(),
          resolvedAtNs: opStatus === 'IN_FLIGHT' ? null : (fundedAtNs + 4_000_000_000n).toString(),
          failureCode: opStatus === 'FAILED' ? ('FT_TRANSFER_FAILED' as const) : null,
        }
      : null,
  };
  return MainnetRequestSchema.parse(request);
}

export interface FixtureEntry {
  readonly scenario: FixtureScenario;
  readonly request: MainnetRequest;
}

export function fixtureRequests(nowMs: number): ReadonlyArray<FixtureEntry> {
  return FIXTURE_SCENARIOS.map((scenario) => ({ scenario, request: buildFixtureRequest(scenario, nowMs) }));
}

/**
 * FIXTURE sale bound with Codex's bindMainnetCommerceTerms to a fixed, obviously
 * synthetic session, so the pay page's commitment check runs on a real bound record.
 */
export const COMMERCE_FIXTURE_SCENARIO: FixtureScenario = { name: 'usdc-commerce-sale', asset: 'USDC', amountBaseUnits: '4200000', status: 'OPEN', oneClick: null, memo: 'Counter 2' };
export function commerceFixture(nowMs: number): { request: MainnetRequest; session: MainnetCommerceSession; termsHash: string } {
  const draft = buildFixtureRequest(COMMERCE_FIXTURE_SCENARIO, nowMs);
  const session: MainnetCommerceSession = { version: 'taply.commerce.v1', network: 'near-mainnet', contractId: FIXTURE_CONTRACT,
    merchantAccountId: FIXTURE_MERCHANT, sessionId: fixtureNonce('sale-session'), sessionNonce: fixtureNonce('sale-nonce'), expiresAtNs: draft.terms.fundingExpiresAtNs };
  const bound = bindMainnetCommerceTerms('instant', draft.terms, session);
  const terms = bound.terms as MainnetIntentTerms;
  return { request: MainnetRequestSchema.parse({ ...draft, terms, termsHash: bound.termsHash }), session, termsHash: bound.termsHash };
}

export function fixtureById(id: string, nowMs: number): FixtureEntry | null {
  const sale = commerceFixture(nowMs);
  if (sale.request.terms.id === id) return { scenario: COMMERCE_FIXTURE_SCENARIO, request: sale.request };
  return fixtureRequests(nowMs).find((f) => f.request.terms.id === id) ?? null;
}

/** Storage bond observed in Codex's sandbox for a USDC request (585 bytes). FIXTURE ONLY: real flows use quote_create_request. */
export const FIXTURE_STORAGE_BOND_YOCTO = '5850000000000000000000';

/**
 * Well-formed PLACEHOLDER code hash used only to build fixture call previews.
 * It is not the CI candidate hash and not any deployment; never pin it.
 */
export const FIXTURE_CODE_HASH = 'GMjfNNjfTPXSmeRaxgN1oS9srsmBSdS46R6y2kPv6JQf';

/**
 * FIXTURE 1Click token list (fixture Preview only), shaped like `/v0/tokens`.
 * Base and Solana asset IDs are the ones recorded in docs/MAINNET_BRIEF.md §3;
 * the Tron entry's asset ID is deliberately marked `fixture` because no live
 * value has been recorded. In dry mode the live list replaces all of this.
 */
export const FIXTURE_TOKENS = Object.freeze([
  { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', blockchain: 'base', symbol: 'USDC', decimals: 6, contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', blockchain: 'sol', symbol: 'USDC', decimals: 6, contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { assetId: 'nep141:tron-fixture-usdt.omft.near', blockchain: 'tron', symbol: 'USDT', decimals: 6, contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
]);
