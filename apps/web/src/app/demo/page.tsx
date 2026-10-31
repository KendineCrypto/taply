'use client';

import { useState } from 'react';
import { Button, Spinner } from '@/components/primitives/Button';
import { FEATURE_FLAGS, FLAGS } from '@/lib/flags/features';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { getNearClient } from '@/lib/near/client';
import type { NearTestnetClient } from '@/lib/near/client';
import { Amount, AccountId } from '@/components/primitives/Amount';
import { Card, DetailRow, ScreenHeader } from '@/components/primitives/Surface';
import { StatusBadge } from '@/components/status/StatusBadge';
import { MockBadge, VerificationChip } from '@/components/status/VerificationChip';
import { useT } from '@/lib/i18n/provider';
import { ASSURANCES, CALLER_ROLES, OBSERVATION_SOURCES } from '@/lib/protocol';
import type { Assurance, CallerRole, ChainState, ObservationSource } from '@/lib/protocol';
import { mapChainState } from '@/lib/payments/map-chain-state';
import {
  MOCK_AMOUNT_BASE_UNITS,
  MOCK_ACCOUNT_PAYER,
  MOCK_ACCOUNT_RECIPIENT,
  MOCK_ASSET,
  MOCK_STATE_MATRIX,
  mockDerived,
  mockDerivedReleaseEligible,
  mockFundingEligibility,
  mockObservation,
} from '@/lib/mock/fixtures';

/**
 * Status matrix - the only route where mock data may render.
 *
 * Its purpose is review: every ChainState, for every caller role, at every
 * assurance level and observation source, side by side. If a change ever made
 * LOCKED or an in-flight state look settled it would be visible immediately -
 * and the unit tests in src/lib/payments/__tests__ would already have failed.
 *
 * The source selector matters: with `mock`, `@taply/shared` pins assurance to
 * `unverified` and forbids any financial affordance, so the CTA column
 * legitimately empties out. Selecting `rpc` shows what a real verified read
 * would present.
 */
export default function DemoPage() {
  const t = useT();
  const [role, setRole] = useState<CallerRole>('payer');
  const [assurance, setAssurance] = useState<Assurance>('verified_final');
  const [source, setSource] = useState<ObservationSource>('mock');

  const effectiveAssurance: Assurance = source === 'mock' ? 'unverified' : assurance;

  return (
    <>
      <ScreenHeader title={t.diagnostics.title} description={t.diagnostics.description} />

      <Diagnostics />

      <h2 className="mb-1 mt-8 text-base font-semibold">{t.diagnostics.statusMatrix}</h2>
      <p className="mb-3 text-sm text-[var(--text-secondary)]">{t.diagnostics.statusMatrixBody}</p>

      <Card className="mb-4 flex items-start justify-between gap-3">
        <p className="text-sm text-[var(--tone-danger-fg)]">{t.mock.demoOnly}</p>
        <MockBadge />
      </Card>

      <Card className="mb-4">
        <Choice
          legend={t.diagnostics.callerRole}
          options={CALLER_ROLES}
          value={role}
          onChange={setRole}
          render={(option) => option}
        />

        <Choice
          legend={t.diagnostics.observationSource}
          options={OBSERVATION_SOURCES}
          value={source}
          onChange={setSource}
          render={(option) => option}
        />

        <Choice
          legend={t.diagnostics.assurance}
          options={ASSURANCES}
          value={effectiveAssurance}
          onChange={setAssurance}
          render={(option) => t.assurance[option].label}
          disabled={source === 'mock'}
        />

        {source === 'mock' && (
          <p className="mt-2 text-xs text-[var(--tone-caution-fg)]">
            {t.diagnostics.mockPinned} ({t.assurance.unverified.label})
          </p>
        )}
      </Card>

      <Card className="mb-4">
        <dl>
          <DetailRow label={t.common.amount} emphasis>
            <Amount baseUnits={MOCK_AMOUNT_BASE_UNITS} asset={MOCK_ASSET} display="exact" />
          </DetailRow>
          <DetailRow label={t.common.payer}>
            <AccountId accountId={MOCK_ACCOUNT_PAYER} />
          </DetailRow>
          <DetailRow label={t.common.recipient}>
            <AccountId accountId={MOCK_ACCOUNT_RECIPIENT} />
          </DetailRow>
        </dl>
      </Card>

      <ul className="flex flex-col gap-3">
        {MOCK_STATE_MATRIX.map((state) => (
          <StateRow
            key={state}
            state={state}
            role={role}
            assurance={effectiveAssurance}
            source={source}
          />
        ))}
        {/* LOCKED after the cutoff: release eligible, cancel closed. */}
        <StateRow
          key="LOCKED-after-cutoff"
          state="LOCKED"
          role={role}
          assurance={effectiveAssurance}
          source={source}
          variantLabel="LOCKED (after cutoff)"
          releaseEligible
        />
      </ul>
    </>
  );
}

function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
  render,
  disabled = false,
}: {
  readonly legend: string;
  readonly options: ReadonlyArray<T>;
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly render: (option: T) => string;
  readonly disabled?: boolean;
}) {
  return (
    <fieldset className="mt-4 first:mt-0" disabled={disabled}>
      <legend className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            className={`tap-target rounded-[var(--radius-control)] border px-3 text-sm disabled:opacity-40 ${
              value === option
                ? 'border-[var(--taply-lime)] text-[var(--taply-lime)]'
                : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
            }`}
          >
            {render(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function StateRow({
  state,
  role,
  assurance,
  source,
  variantLabel,
  releaseEligible = false,
}: {
  readonly state: ChainState;
  readonly role: CallerRole;
  readonly assurance: Assurance;
  readonly source: ObservationSource;
  readonly variantLabel?: string;
  readonly releaseEligible?: boolean;
}) {
  const t = useT();
  const observation = mockObservation(assurance, source);
  const derived = releaseEligible ? mockDerivedReleaseEligible(role) : mockDerived(state, role);
  const input = {
    state,
    observation,
    derived,
    fundingEligibility: mockFundingEligibility(state),
    incident: null,
    // Mock data can never carry settlement proof.
    settlementProof: 'contract_state_only',
  } as const;
  const presentation = mapChainState(input);
  const copy = t.status[state];

  return (
    <Card as="li">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-[var(--text-muted)]">{variantLabel ?? state}</span>
        <StatusBadge {...input} />
      </div>

      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {presentation.audience === 'recipient' ? copy.recipient : copy.payer}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <VerificationChip observation={observation} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          money: {presentation.money}
        </span>
        {presentation.projectionContradiction && (
          <span className="font-mono text-[10px] uppercase text-[var(--tone-danger-fg)]">
            projection contradiction
          </span>
        )}
      </div>

      {presentation.ctas.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {presentation.ctas.map((cta) => (
            <span
              key={cta.kind}
              className={`inline-flex items-center rounded-[var(--radius-control)] border px-3 py-2 text-sm ${
                cta.emphasis === 'primary'
                  ? 'border-[var(--taply-lime)] text-[var(--taply-lime)]'
                  : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
              }`}
            >
              {cta.kind.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Printed so the fail-closed rules are checkable by eye, not just by test. */}
      <p className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">
        verifiedRibbon: {String(presentation.verifiedRibbon)} · tone: {presentation.tone} · ctas:{' '}
        {presentation.ctas.length}
      </p>
    </Card>
  );
}

/** Build and chain diagnostics. Technical by design; this route is for reviewers. */
function Diagnostics() {
  const t = useT();

  return (
    <div className="flex flex-col gap-4">
      <Card as="section">
        <h2 className="mb-1 text-sm font-semibold">{t.diagnostics.chainConfig}</h2>
        {CHAIN_CONFIG.ok ? (
          <>
            <dl>
              <DetailRow label="network">
                <span className="chain-id">{CHAIN_CONFIG.client.network}</span>
              </DetailRow>
              <DetailRow label="rpcUrl">
                <span className="chain-id">{CHAIN_CONFIG.client.rpcUrl}</span>
              </DetailRow>
              <DetailRow label="rpcProviderId">
                <span className="chain-id">{CHAIN_CONFIG.client.rpcProviderId}</span>
              </DetailRow>
              <DetailRow label="contract">
                <span className="chain-id">null</span>
              </DetailRow>
              <DetailRow label="explorer">
                <span className="chain-id">{CHAIN_CONFIG.explorerBaseUrl}</span>
              </DetailRow>
            </dl>
            <NetworkCheck client={getNearClient()} />
          </>
        ) : (
          <p className="text-sm text-[var(--tone-danger-fg)]">
            {t.diagnostics.chainConfigInvalid} <span className="font-mono text-xs">({CHAIN_CONFIG.reason})</span>
          </p>
        )}
      </Card>

      <Card as="section">
        <h2 className="mb-1 text-sm font-semibold">{t.diagnostics.capabilities}</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">{t.diagnostics.capabilitiesBody}</p>
        <ul className="flex flex-col">
          {FEATURE_FLAGS.map((flag) => {
            const state = FLAGS[flag];
            return (
              <li
                key={flag}
                className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] py-2 text-sm last:border-b-0"
              >
                <span className="font-mono text-xs">{flag}</span>
                <span className={state.enabled ? 'text-[var(--tone-success-fg)]' : 'text-[var(--tone-caution-fg)]'}>
                  {state.enabled ? t.diagnostics.enabled : state.reason.replace(/_/g, ' ')}
                  {state.hardDisabled ? ` · ${t.diagnostics.locked}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card as="section">
        <h2 className="mb-2 text-sm font-semibold">{t.diagnostics.dependencies}</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[var(--text-secondary)]">
          {t.diagnostics.dependencyItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

type NetworkCheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'ok'; readonly height: string; readonly nodeVersion: string }
  | { readonly kind: 'failed'; readonly code: string };

/** Live Testnet identity check via @taply/near-client (status + final block). */
function NetworkCheck({ client }: { readonly client: NearTestnetClient | null }) {
  const t = useT();
  const [state, setState] = useState<NetworkCheckState>({ kind: 'idle' });
  if (client === null) return null;

  const run = async () => {
    setState({ kind: 'checking' });
    const result = await client.checkNetwork();
    if (result.error === null && result.observation.data !== null && result.observation.observedBlock !== null) {
      setState({
        kind: 'ok',
        height: result.observation.observedBlock.height,
        nodeVersion: result.observation.data.nodeVersion,
      });
    } else {
      setState({ kind: 'failed', code: result.error?.code ?? 'UNKNOWN' });
    }
  };

  return (
    <div className="mt-3" aria-live="polite">
      <Button variant="secondary" onClick={() => void run()} disabled={state.kind === 'checking'}>
        {state.kind === 'checking' && <Spinner />}
        {state.kind === 'checking' ? t.diagnostics.checking : t.diagnostics.checkNetwork}
      </Button>
      {state.kind === 'ok' && (
        <p className="mt-2 font-mono text-xs text-[var(--tone-success-fg)]">
          {t.diagnostics.networkOk} · final #{state.height} · nearcore {state.nodeVersion}
        </p>
      )}
      {state.kind === 'failed' && (
        <p className="mt-2 font-mono text-xs text-[var(--tone-danger-fg)]">{state.code}</p>
      )}
    </div>
  );
}
