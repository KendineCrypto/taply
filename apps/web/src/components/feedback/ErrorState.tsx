'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/provider';
import { isAutoRetryableRead, isUnknownOutcome } from '@/lib/protocol';
import type { ErrorCode } from '@/lib/protocol';
import type { Dictionary } from '@/lib/i18n';
import type { FeatureFlag, FlagState } from '@/lib/flags/features';

/**
 * Protocol error presentation.
 *
 * `code` is a `@taply/shared` ErrorCode. Copy comes from the local dictionary
 * keyed by that code; server-supplied prose is never rendered (freeze section 8:
 * "Frontend must map localized keys, never render untrusted raw server error
 * prose").
 */
export function ErrorState({
  code,
  action,
}: {
  readonly code: ErrorCode;
  readonly action?: ReactNode;
}) {
  const t = useT();
  const copy = t.errors[code];
  const unknown = isUnknownOutcome(code);

  const tone = unknown
    ? 'border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)]'
    : isAutoRetryableRead(code)
      ? 'border-[var(--border-subtle)] bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-fg)]'
      : 'border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]';

  return (
    <div className={`rounded-[var(--radius-card)] border p-4 ${tone}`} role="alert">
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden="true">!</span>
        {copy.title}
      </p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{copy.body}</p>

      {unknown && (
        /**
         * Lead decision 9: unknown outcomes must never become Paid or be retried
         * automatically. No retry affordance is rendered at all - resolving an
         * unknown outcome goes through a chain-status check instead. The shared
         * ApiErrorSchema independently forces retryAction WAIT_AND_RECONCILE for
         * exactly these codes.
         */
        <p className="mt-2 text-xs text-[var(--tone-caution-fg)]">{t.common.checkChainStatus}</p>
      )}

      {!unknown && action !== undefined && <div className="mt-3">{action}</div>}

      {/* Machine-readable code, for bug reports and for judges reading the DOM. */}
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{code}</p>
    </div>
  );
}

/**
 * Client-side conditions that are NOT protocol errors: browser offline, an
 * unexpected render failure, a capability that is switched off, chain time we
 * could not read, or a response whose derived flags contradict themselves.
 *
 * Keeping these separate from `ErrorState` stops the UI from inventing API error
 * codes that `@taply/shared` does not define.
 */
export function NoticeState({
  notice,
  severity = 'caution',
  action,
}: {
  readonly notice: keyof Dictionary['notices'];
  readonly severity?: 'caution' | 'danger' | 'neutral';
  readonly action?: ReactNode;
}) {
  const t = useT();
  const copy = t.notices[notice];

  const tone =
    severity === 'danger'
      ? 'border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]'
      : severity === 'neutral'
        ? 'border-[var(--border-subtle)] bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-fg)]'
        : 'border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)]';

  return (
    <div className={`rounded-[var(--radius-card)] border p-4 ${tone}`} role="alert">
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden="true">!</span>
        {copy.title}
      </p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">{copy.body}</p>
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * Honest disabled surface. NEXT_STEPS.md prompt E requires "disabled feature
 * flags for unverified capabilities" and CLAUDE.md requires an honest
 * coming-later label rather than a dead control.
 */
export function FeatureDisabled({
  flag,
  state,
  title,
}: {
  readonly flag: FeatureFlag;
  readonly state: FlagState;
  readonly title?: string;
}) {
  const t = useT();

  const reasonCopy: Record<FlagState['reason'], string> = {
    not_implemented: t.flags.comingLater,
    awaiting_testnet_proof: t.flags.requiresVerification,
    security_gate: t.flags.requiresVerification,
    disabled_by_config: t.flags.disabledBody,
    enabled: '',
  };

  return (
    <div
      className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] bg-[var(--tone-muted-bg)] p-4"
      aria-disabled="true"
    >
      <p className="font-medium text-[var(--text-secondary)]">{title ?? t.flags.disabledTitle}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{t.flags.disabledBody}</p>
      <p className="mt-2 text-xs text-[var(--tone-caution-fg)]">{reasonCopy[state.reason]}</p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {flag} · {state.reason}
        {state.hardDisabled ? ' · locked' : ''}
      </p>
    </div>
  );
}
