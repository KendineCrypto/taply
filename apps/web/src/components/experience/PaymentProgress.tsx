'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';
import { STAGE_TONE, STEP_KEYS, stepsFor } from './progress';
import type { ProgressStage, StageTone, StepState } from './progress';

/**
 * Payment progress hero + five-step timeline.
 *
 * The stage comes from `progressStageFor` (contract state, local wallet phase
 * and the independent verifier). The lime success treatment exists only for
 * `verified`. Everything else is calm (neutral), pending (gold) or muted, and
 * every state also has its own glyph and words - never colour alone.
 */

const ICON: Readonly<Record<ProgressStage, IconName>> = {
  awaiting: 'clock',
  wallet: 'wallet',
  transfer: 'send',
  contract_paid: 'check',
  verified: 'shield',
  failed: 'alert',
  unresolved: 'alert',
  cancelled: 'x',
};

const TONE_RING: Readonly<Record<StageTone, string>> = {
  neutral: 'bg-[rgb(244_243_232/0.08)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]',
  caution: 'bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)] ring-1 ring-[var(--tone-caution-border)]',
  success: 'bg-[var(--taply-lime)] text-[var(--taply-night)]',
  muted: 'bg-[var(--tone-muted-bg)] text-[var(--text-muted)] ring-1 ring-[var(--border-subtle)]',
};

const TONE_TITLE: Readonly<Record<StageTone, string>> = {
  neutral: 'text-[var(--text-primary)]',
  caution: 'text-[var(--tone-caution-fg)]',
  success: 'text-[var(--taply-lime)]',
  muted: 'text-[var(--text-secondary)]',
};

const PENDING: ReadonlyArray<ProgressStage> = ['wallet', 'transfer'];

export function PaymentProgress({
  stage,
  audienceNote,
  footer,
}: {
  readonly stage: ProgressStage;
  /** Optional role-specific sentence under the stage description. */
  readonly audienceNote?: string | undefined;
  readonly footer?: ReactNode;
}) {
  const t = useT();
  const tone = STAGE_TONE[stage];
  const copy = t.experience.progress.stages[stage];
  const steps = stepsFor(stage);

  return (
    <section aria-labelledby="progress-title" className="surface-hero animate-rise p-5" data-stage={stage}>
      <div className="flex items-start gap-4">
        <span
          className={`grid size-14 shrink-0 place-items-center rounded-full ${TONE_RING[tone]} ${
            PENDING.includes(stage) ? 'animate-halo' : ''
          }`}
        >
          {stage === 'verified' ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
              <path d="m9 12 2.2 2.2L15.5 10" className="animate-draw" />
            </svg>
          ) : (
            <Icon name={ICON[stage]} size={26} />
          )}
        </span>
        <div className="min-w-0 pt-0.5" role="status" aria-live={stage === 'failed' || stage === 'unresolved' ? 'assertive' : 'polite'}>
          <p className="eyebrow text-[var(--text-muted)]">{t.experience.progress.title}</p>
          <h2 id="progress-title" className={`mt-1.5 text-[1.375rem] font-semibold leading-tight tracking-tight ${TONE_TITLE[tone]}`}>
            {copy.title}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{copy.body}</p>
          {audienceNote !== undefined && <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{audienceNote}</p>}
        </div>
      </div>

      <ol className="mt-5 grid gap-0" aria-label={t.experience.progress.title}>
        {STEP_KEYS.map((key, index) => (
          <Step key={key} label={t.experience.progress.steps[key]} state={steps[key]} last={index === STEP_KEYS.length - 1} stateLabel={t.experience.progress.stepState[steps[key]]} />
        ))}
      </ol>
      {footer !== undefined && <div className="mt-4">{footer}</div>}
    </section>
  );
}

function Step({ label, state, last, stateLabel }: { readonly label: string; readonly state: StepState; readonly last: boolean; readonly stateLabel: string }) {
  const dot: Record<StepState, string> = {
    done: 'bg-[var(--text-primary)] text-[var(--taply-night)]',
    current: 'bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)] ring-1 ring-[var(--tone-caution-border)]',
    todo: 'bg-transparent ring-1 ring-[var(--border-strong)] text-transparent',
    failed: 'bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)] ring-1 ring-[var(--tone-caution-border)]',
  };
  const text: Record<StepState, string> = {
    done: 'text-[var(--text-primary)]',
    current: 'text-[var(--text-primary)] font-medium',
    todo: 'text-[var(--text-muted)]',
    failed: 'text-[var(--tone-caution-fg)] font-medium',
  };
  return (
    <li className="flex gap-3">
      <span className="flex flex-col items-center">
        <span className={`grid size-5 place-items-center rounded-full ${dot[state]}`} aria-hidden="true">
          {state === 'done' && <Icon name="check" size={12} />}
          {state === 'failed' && <span className="text-[10px] font-bold">!</span>}
          {state === 'current' && <span className="size-1.5 rounded-full bg-current" />}
        </span>
        {!last && <span aria-hidden="true" className={`w-px flex-1 ${state === 'done' ? 'bg-[var(--border-strong)]' : 'bg-[var(--border-subtle)]'} min-h-4`} />}
      </span>
      <span className={`pb-3 text-sm leading-5 ${text[state]}`}>
        {label}
        <span className="sr-only">: {stateLabel}</span>
      </span>
    </li>
  );
}
