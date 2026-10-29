import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ASSURANCES,
  CHAIN_STATES,
  CALLER_ROLES,
  ERROR_CODES,
  OBSERVATION_SOURCES,
  PAY_MODES,
  SESSION_STATES,
  UNKNOWN_OUTCOME_CODES,
  ApiErrorSchema,
  ChainStateSchema,
  ComparisonCodeSchema,
  ContractRequestSchema,
  IntentTermsSchema,
  PaymentIntentResponseSchema,
  calculateRequestId,
  calculateSessionCommitment,
  calculateTermsHash,
  canonicalJson,
  comparisonCode,
  createChainObservationSchema,
  isUnknownOutcome,
  isVerifiedPaid,
  parseIntentTermsJson,
  parseStrictJson,
  retryRoleMatchesKind,
} from '@/lib/protocol';
import type { Assurance, IntentTerms, ObservationSource } from '@/lib/protocol';

/**
 * Frontend <-> `@taply/shared` compatibility.
 *
 * This file is the contract check for Phase 0.5. It proves that:
 *  - the frontend consumes Codex's real hashing functions and reproduces the
 *    lead-frozen fixture digests and comparison codes byte for byte;
 *  - mutating the session binding changes the commitment and the code, which is
 *    the question raised against Protocol Freeze v1 section 7;
 *  - the frontend's local enum lists are exactly the shared unions;
 *  - the shared schemas reject the unsafe states the UI relies on them to reject;
 *  - the frontend's own fail-closed helpers agree with the shared schema rules.
 *
 * The expected digests are LEAD-FROZEN CALCULATED FIXTURES, not Testnet
 * evidence, exactly as `packages/shared/test-vectors/README.md` states.
 */

// Monorepo-relative: apps/web/src/lib/protocol/__tests__ -> repo root.
const VECTORS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../packages/shared/test-vectors',
);

function readVector(name: string): string {
  return readFileSync(join(VECTORS_DIR, name), 'utf8');
}

interface ExpectedVectors {
  readonly requestId: string;
  readonly a: { termsHash: string; sessionCommitment: string; comparisonCode: string };
  readonly b: { termsHash: string; sessionCommitment: string; comparisonCode: string };
  readonly time: { fundedAtNs: string; cancelDurationNs: string; cancelUntilNs: string };
}

const expected = JSON.parse(readVector('expected.json')) as ExpectedVectors;
const intentAJson = readVector('intent-a.json');
const intentBJson = readVector('intent-b.json');
const canonicalA = readVector('intent-a.canonical.json');
const canonicalB = readVector('intent-b.canonical.json');

const termsA: IntentTerms = parseIntentTermsJson(intentAJson);
const termsB: IntentTerms = parseIntentTermsJson(intentBJson);

describe('the frozen vectors are reachable and valid from apps/web', () => {
  it('parses both fixtures through the shared strict parser and schema', () => {
    expect(termsA.schemaVersion).toBe('taply.intent.v1');
    expect(termsB.schemaVersion).toBe('taply.intent.v1');
    expect(IntentTermsSchema.safeParse(termsA).success).toBe(true);
    expect(IntentTermsSchema.safeParse(termsB).success).toBe(true);
  });

  it('labels the fixtures as calculated, not chain evidence', () => {
    const raw = JSON.parse(readVector('expected.json')) as Record<string, unknown>;
    expect(raw['evidence']).toBe('CALCULATED_FIXTURES_NOT_CHAIN_PROOF');
  });
});

describe('canonical hashing matches the lead-frozen fixtures exactly', () => {
  it('reproduces the JCS canonical bytes for fixture A', () => {
    expect(canonicalJson(termsA)).toBe(canonicalA);
  });

  it('reproduces the JCS canonical bytes for fixture B', () => {
    expect(canonicalJson(termsB)).toBe(canonicalB);
  });

  it('reproduces requestId for both fixtures', () => {
    const identity = {
      contractId: termsA.contractId,
      creationNonce: termsA.creationNonce,
      creatorAccountId: termsA.creatorAccountId,
      network: termsA.network,
    };
    expect(calculateRequestId(identity)).toBe(expected.requestId);
    expect(termsA.id).toBe(expected.requestId);
    // Fixture B differs only in amount, so the creator-scoped ID is unchanged.
    expect(termsB.id).toBe(expected.requestId);
  });

  it('reproduces termsHash for fixture A and B', () => {
    expect(calculateTermsHash(termsA)).toBe(expected.a.termsHash);
    expect(calculateTermsHash(termsB)).toBe(expected.b.termsHash);
    expect(expected.a.termsHash).not.toBe(expected.b.termsHash);
  });

  it('reproduces sessionCommitment for fixture A and B', () => {
    expect(calculateSessionCommitment(termsA)).toBe(expected.a.sessionCommitment);
    expect(calculateSessionCommitment(termsB)).toBe(expected.b.sessionCommitment);
  });

  it('reproduces the 6-character comparison code for fixture A and B', () => {
    expect(comparisonCode(expected.a.sessionCommitment)).toBe(expected.a.comparisonCode);
    expect(comparisonCode(expected.b.sessionCommitment)).toBe(expected.b.comparisonCode);
    expect(expected.a.comparisonCode).toBe('XMBVTN');
    expect(expected.b.comparisonCode).toBe('684MZB');
  });

  it('emits codes in the Crockford base32 alphabet the UI renders', () => {
    for (const code of [expected.a.comparisonCode, expected.b.comparisonCode]) {
      expect(ComparisonCodeSchema.safeParse(code).success).toBe(true);
      expect(code).toHaveLength(6);
    }
  });

  it('derives the protected cutoff as funding time plus the immutable duration', () => {
    const cutoff = BigInt(expected.time.fundedAtNs) + BigInt(expected.time.cancelDurationNs);
    expect(cutoff.toString()).toBe(expected.time.cancelUntilNs);
  });
});

describe('a one-unit amount change moves the terms hash but not the request ID', () => {
  it('keeps the deterministic ID and changes every terms-derived digest', () => {
    expect(termsA.id).toBe(termsB.id);
    expect(calculateTermsHash(termsA)).not.toBe(calculateTermsHash(termsB));
    expect(calculateSessionCommitment(termsA)).not.toBe(calculateSessionCommitment(termsB));
    expect(comparisonCode(expected.a.sessionCommitment)).not.toBe(
      comparisonCode(expected.b.sessionCommitment),
    );
    // One yoctoNEAR apart.
    expect(BigInt(termsB.amountBaseUnits) - BigInt(termsA.amountBaseUnits)).toBe(1n);
  });
});

/**
 * Session-binding mutation.
 *
 * Against Protocol Freeze v1 section 7 I raised that `sessionCommitment` is
 * derived from `termsHash` alone, which looked like it would make the comparison
 * code identical across sessions with identical terms. The shared schema answers
 * it: `sessionBinding` is itself part of `IntentTerms`, so it is inside
 * `termsHash`. These cases prove the binding really does change the code.
 */
describe('session binding is bound into the terms hash and the comparison code', () => {
  function withBinding(overrides: Partial<NonNullable<IntentTerms['sessionBinding']>>): IntentTerms {
    const binding = termsA.sessionBinding;
    expect(binding).not.toBeNull();
    return IntentTermsSchema.parse({
      ...termsA,
      sessionBinding: { ...binding!, ...overrides },
    });
  }

  it('changes the commitment and code when only the session nonce changes', () => {
    const mutated = withBinding({
      nonce: '00000000000000000000000000000000000000000000000000000000000000ff',
    });
    expect(mutated.id).toBe(termsA.id);
    expect(calculateTermsHash(mutated)).not.toBe(calculateTermsHash(termsA));
    expect(calculateSessionCommitment(mutated)).not.toBe(expected.a.sessionCommitment);
    expect(comparisonCode(calculateSessionCommitment(mutated)!)).not.toBe(expected.a.comparisonCode);
  });

  it('changes the commitment and code when only the session id changes', () => {
    const mutated = withBinding({ id: '22222222-2222-4222-8222-222222222222' });
    expect(mutated.id).toBe(termsA.id);
    expect(calculateSessionCommitment(mutated)).not.toBe(expected.a.sessionCommitment);
    expect(comparisonCode(calculateSessionCommitment(mutated)!)).not.toBe(expected.a.comparisonCode);
  });

  it('changes the commitment when only the session expiry changes', () => {
    const mutated = withBinding({ expiresAtNs: '1793520400000000000' });
    expect(calculateSessionCommitment(mutated)).not.toBe(expected.a.sessionCommitment);
  });

  it('yields a null commitment when there is no session binding', () => {
    const unbound = IntentTermsSchema.parse({ ...termsA, sessionBinding: null });
    expect(calculateSessionCommitment(unbound)).toBeNull();
    expect(calculateTermsHash(unbound)).not.toBe(calculateTermsHash(termsA));
  });

  it('rejects a merchant account that is not the creator, so a payee cannot be swapped', () => {
    const substituted = IntentTermsSchema.safeParse({
      ...termsA,
      merchantAccountId: 'attacker.testnet',
    });
    expect(substituted.success).toBe(false);
  });

  it('rejects terms whose id does not match the creator-scoped identity', () => {
    const forged = IntentTermsSchema.safeParse({ ...termsA, creatorAccountId: 'attacker.testnet' });
    expect(forged.success).toBe(false);
  });
});

describe('strict JSON parsing is the shared implementation, not JSON.parse', () => {
  it('rejects a duplicate key, including a unicode-escaped alias', () => {
    const duplicated = intentAJson.replace(
      '"amountBaseUnits": "1000000000000000000000000",',
      '"amountBaseUnits": "1000000000000000000000000",\n  "\\u0061mountBaseUnits": "1",',
    );
    // Ordinary JSON.parse silently keeps one of the two.
    expect(() => JSON.parse(duplicated)).not.toThrow();
    expect(() => parseStrictJson(duplicated)).toThrow();
  });

  it('rejects comments and trailing commas', () => {
    expect(() => parseStrictJson('{"a":1,}')).toThrow();
    expect(() => parseStrictJson('{"a":1} // trailing')).toThrow();
  });
});

describe('frontend enum lists are exactly the shared unions', () => {
  it('mirrors ChainState', () => {
    expect([...CHAIN_STATES]).toEqual([...ChainStateSchema.options]);
    expect(CHAIN_STATES).toHaveLength(11);
    expect(CHAIN_STATES).not.toContain('EXPIRED');
    expect(CHAIN_STATES).not.toContain('FUNDING');
    expect(CHAIN_STATES).not.toContain('DISCONNECTED');
  });

  it('mirrors CallerRole, PayMode and SessionState', () => {
    expect([...CALLER_ROLES]).toEqual([
      'anonymous',
      'payer',
      'recipient',
      'payer_and_recipient',
      'observer',
    ]);
    expect([...PAY_MODES]).toEqual(['instant', 'protected']);
    expect([...SESSION_STATES]).toEqual(['DRAFT', 'OPEN', 'PAIRED', 'REVIEWED', 'EXPIRED', 'CLOSED']);
  });

  /**
   * `assurance` and `source` are inline in the shared observation schema, so the
   * frontend keeps its own lists. These checks prove each list member is
   * accepted and that nothing outside it is.
   */
  it('mirrors the assurance union accepted by the shared observation schema', () => {
    const schema = createChainObservationSchema(ChainStateSchema);
    for (const assurance of ASSURANCES) {
      const candidate = {
        data: 'OPEN',
        source: 'rpc',
        assurance,
        observedBlock: { hash: '11111111111111111111111111111111', height: '1', timestampNs: '1' },
        checkedAt: '2026-10-29T00:00:00.000',
        stale: false,
        rpcAvailable: true,
      };
      const issues = schema.safeParse(candidate);
      // Some members carry extra constraints; none may fail on the enum itself.
      const enumRejected =
        !issues.success &&
        issues.error.issues.some((issue) => issue.path.includes('assurance') && issue.code === 'invalid_value');
      expect(enumRejected, assurance).toBe(false);
    }
    expect(schema.safeParse({ data: 'OPEN', source: 'rpc', assurance: 'definitely_paid' }).success).toBe(
      false,
    );
  });

  it('mirrors the observation source union, and "chain" is not a member', () => {
    expect([...OBSERVATION_SOURCES]).toEqual(['rpc', 'index', 'mock']);
    const schema = createChainObservationSchema(ChainStateSchema);
    // The pre-integration mirror used 'chain'; the real protocol says 'rpc'.
    expect(
      schema.safeParse({
        data: 'OPEN',
        source: 'chain',
        assurance: 'unverified',
        observedBlock: null,
        checkedAt: '2026-10-29T00:00:00.000',
        stale: false,
        rpcAvailable: true,
      }).success,
    ).toBe(false);
  });

  it('mirrors the ErrorCode union', () => {
    expect(ERROR_CODES).toHaveLength(56);
    expect(ERROR_CODES).toContain('RPC_TIMEOUT_UNKNOWN_STATUS');
    expect(ERROR_CODES).toContain('RECONCILIATION_REQUIRED');
  });
});

describe('shared schemas reject the unsafe states the UI depends on them rejecting', () => {
  const schema = createChainObservationSchema(ChainStateSchema);
  const block = { hash: '11111111111111111111111111111111', height: '10', timestampNs: '100' };

  it('refuses a mock observation that claims chain verification', () => {
    for (const assurance of ['verified_final', 'pending_finality'] as const) {
      expect(
        schema.safeParse({
          data: 'FINAL_PAID',
          source: 'mock',
          assurance,
          observedBlock: block,
          checkedAt: '2026-10-29T00:00:00.000',
          stale: false,
          rpcAvailable: true,
        }).success,
        assurance,
      ).toBe(false);
    }
  });

  it('refuses a verified observation with no block provenance', () => {
    expect(
      schema.safeParse({
        data: 'FINAL_PAID',
        source: 'rpc',
        assurance: 'verified_final',
        observedBlock: null,
        checkedAt: '2026-10-29T00:00:00.000',
        stale: false,
        rpcAvailable: true,
      }).success,
    ).toBe(false);
  });

  it('refuses an ApiError whose unknown-outcome code claims a retryable action', () => {
    for (const code of UNKNOWN_OUTCOME_CODES) {
      const base = {
        schemaVersion: 'taply.api.v1',
        error: {
          code,
          messageKey: `errors.${code}`,
          requestId: 'req-1',
          retryAfterMs: null,
          details: {},
        },
      };
      expect(
        ApiErrorSchema.safeParse({ ...base, error: { ...base.error, retryAction: 'WAIT_AND_RECONCILE' } })
          .success,
        code,
      ).toBe(true);
      expect(
        ApiErrorSchema.safeParse({ ...base, error: { ...base.error, retryAction: 'RETRY_SAME_OPERATION' } })
          .success,
        code,
      ).toBe(false);
    }
  });

  it('refuses an ApiError whose translation key does not match its code', () => {
    expect(
      ApiErrorSchema.safeParse({
        schemaVersion: 'taply.api.v1',
        error: {
          code: 'USER_REJECTED',
          messageKey: 'errors.FINAL_PAID',
          requestId: 'req-1',
          retryAction: 'NONE',
          retryAfterMs: null,
          details: {},
        },
      }).success,
    ).toBe(false);
  });

  it('refuses a ContractRequest that reports funded fields while unfunded', () => {
    expect(
      ContractRequestSchema.safeParse({
        terms: termsA,
        termsHash: calculateTermsHash(termsA),
        sessionCommitment: calculateSessionCommitment(termsA),
        recipientAccountId: termsA.creatorAccountId,
        status: 'OPEN',
        revision: '1',
        createdAtNs: '1793520000000000000',
        payerAccountId: 'mock-payer.testnet',
        fundedAtNs: '1793520000000000000',
        cancelUntilNs: null,
        settlementBranch: null,
        latestOperation: null,
      }).success,
    ).toBe(false);
  });

  it('refuses a PaymentIntentResponse where a stale observation enables an action', () => {
    expect(
      PaymentIntentResponseSchema.safeParse({
        observation: {
          data: null,
          source: 'index',
          assurance: 'unverified',
          observedBlock: null,
          checkedAt: '2026-10-29T00:00:00.000',
          stale: true,
          rpcAvailable: false,
        },
        fundingEligibility: 'ELIGIBLE',
        incident: null,
        derived: {
          callerRole: 'payer',
          cancelWindowOpen: true,
          releaseEligible: false,
          retry: { eligible: false, operationNonce: null, kind: null },
        },
      }).success,
    ).toBe(false);
  });
});

describe('frontend fail-closed helpers agree with the shared rules', () => {
  it('isVerifiedPaid requires FINAL_PAID, verified_final and a non-mock source', () => {
    expect(isVerifiedPaid('FINAL_PAID', 'verified_final', 'rpc')).toBe(true);
    expect(isVerifiedPaid('FINAL_PAID', 'verified_final', 'index')).toBe(true);
    expect(isVerifiedPaid('FINAL_PAID', 'verified_final', 'mock')).toBe(false);
    for (const assurance of ASSURANCES.filter((a) => a !== 'verified_final')) {
      expect(isVerifiedPaid('FINAL_PAID', assurance, 'rpc'), assurance).toBe(false);
    }
    for (const state of CHAIN_STATES.filter((s) => s !== 'FINAL_PAID')) {
      expect(isVerifiedPaid(state, 'verified_final', 'rpc'), state).toBe(false);
    }
  });

  it('retryRoleMatchesKind mirrors the shared retry authorization rule', () => {
    expect(retryRoleMatchesKind('payer', 'PROTECTED_REFUND')).toBe(true);
    expect(retryRoleMatchesKind('recipient', 'PROTECTED_REFUND')).toBe(false);
    expect(retryRoleMatchesKind('recipient', 'PROTECTED_RELEASE')).toBe(true);
    expect(retryRoleMatchesKind('recipient', 'INSTANT_PAYOUT')).toBe(true);
    expect(retryRoleMatchesKind('payer', 'INSTANT_PAYOUT')).toBe(false);
    expect(retryRoleMatchesKind('payer_and_recipient', 'PROTECTED_REFUND')).toBe(true);
    expect(retryRoleMatchesKind('payer_and_recipient', 'INSTANT_PAYOUT')).toBe(true);
    expect(retryRoleMatchesKind('anonymous', 'INSTANT_PAYOUT')).toBe(false);
    expect(retryRoleMatchesKind('observer', 'PROTECTED_REFUND')).toBe(false);
  });

  it('isUnknownOutcome covers exactly the codes the shared schema pins to WAIT_AND_RECONCILE', () => {
    const pinned = ERROR_CODES.filter((code) => {
      const result = ApiErrorSchema.safeParse({
        schemaVersion: 'taply.api.v1',
        error: {
          code,
          messageKey: `errors.${code}`,
          requestId: 'req-1',
          retryAction: 'NONE',
          retryAfterMs: null,
          details: {},
        },
      });
      // A code is pinned when retryAction 'NONE' is rejected for it.
      return !result.success;
    });
    expect([...pinned].sort()).toEqual([...UNKNOWN_OUTCOME_CODES].sort());
    for (const code of pinned) expect(isUnknownOutcome(code), code).toBe(true);
  });
});

describe('type-level alignment is exercised at runtime', () => {
  it('accepts every declared assurance and source as the declared type', () => {
    const assurances: ReadonlyArray<Assurance> = ASSURANCES;
    const sources: ReadonlyArray<ObservationSource> = OBSERVATION_SOURCES;
    expect(assurances).toHaveLength(5);
    expect(sources).toHaveLength(3);
  });
});
