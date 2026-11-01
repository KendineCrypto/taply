'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import type { TitleBody } from '@/lib/i18n/commerce-types';
import { groupCode, saleCode } from '@/lib/merchant/journey';
import type { JourneyContext, JourneySide } from '@/lib/merchant/journey';
import { AmountHero, Monogram } from './Basics';
import { STAGE_TONE, STEP_KEYS, stepsFor } from './progress';
import type { ProgressStage, StepKey, StepState } from './progress';

/**
 * Shared payment session hero (Phase 7F).
 *
 * The merchant's phone and the customer's phone render this same surface for
 * the same request: the same amount, receiving account, sale code and
 * five-step timeline, with headlines worded for each side.
 *
 * Honesty rules:
 *  - `stage` comes from `progressStageFor` (contract state, this device's
 *    wallet phase, the independent verifier). This component never derives it.
 *  - The counterpart line states only what the chain shows. Live presence of
 *    the other phone needs Handshake, which is not live; it is never implied.
 *  - The lime success treatment exists only for `verified`.
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

const TONE_RING = {
  neutral: 'bg-[rgb(244_243_232/0.08)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]',
  caution: 'bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)] ring-1 ring-[var(--tone-caution-border)]',
  success: 'bg-[var(--taply-lime)] text-[var(--taply-night)]',
  muted: 'bg-[var(--tone-muted-bg)] text-[var(--text-muted)] ring-1 ring-[var(--border-subtle)]',
} as const;

const TONE_TITLE = {
  neutral: 'text-[var(--text-primary)]',
  caution: 'text-[var(--tone-caution-fg)]',
  success: 'text-[var(--taply-lime)]',
  muted: 'text-[var(--text-secondary)]',
} as const;

const PENDING: ReadonlyArray<ProgressStage> = ['awaiting', 'wallet', 'transfer'];

export interface SharedSessionProps {
  readonly side: JourneySide;
  readonly context: JourneyContext;
  readonly stage: ProgressStage;
  readonly requestId: string;
  readonly amountBaseUnits: string;
  readonly recipientAccountId: string;
  readonly payerAccountId: string | null;
  /** False when the block right below already shows the amount large (QR ticket, pay review). */
  readonly showAmount: boolean;
  /** This screen is re-reading the chain by itself. */
  readonly live: boolean;
  readonly audienceNote?: string | undefined;
  readonly footer?: ReactNode;
}

export function SharedSession({
  side,
  context,
  stage,
  requestId,
  amountBaseUnits,
  recipientAccountId,
  payerAccountId,
  showAmount,
  live,
  audienceNote,
  footer,
}: SharedSessionProps) {
  const t = useT();
  const j = t.commerce.journey;
  const tone = STAGE_TONE[stage];
  const copy = stageCopy(t.commerce.journey, t.experience.progress.stages, side, context, stage);
  const code = saleCode(requestId);
  const eyebrow = side === 'receiver' ? (context === 'pos' ? j.eyebrow.pos : j.eyebrow.receiving) : context === 'checkout' ? j.eyebrow.checkout : j.eyebrow.request;
  const counterpart = counterpartLine(j, side, context, stage, payerAccountId);

  return (
    <section
      aria-labelledby="journey-title"
      className="journey-hero surface-hero animate-rise p-5"
      data-stage={stage}
      data-tone={tone}
      data-live={live || undefined}
      data-side={side}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="eyebrow text-[var(--text-muted)]">{eyebrow}</p>
          {live && <LivePill />}
        </div>
        {/* With the QR ticket below, the code is printed on the ticket instead. */}
        {code !== null && (showAmount || side === 'payer') && <SaleCodeChip code={code} />}
      </div>

      {showAmount && <AmountHero baseUnits={amountBaseUnits} size="lg" className="mt-4" />}

      <div className="mt-4 flex items-center gap-3">
        <Monogram accountId={recipientAccountId} size={36} />
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-muted)]">{j.payTo}</p>
          <p className="chain-id text-[0.9375rem] font-semibold text-[var(--text-primary)]">{recipientAccountId}</p>
        </div>
      </div>

      {/* Keyed by stage: each change of state arrives with a short transition. */}
      <div key={stage} className="animate-page mt-5 flex items-start gap-4">
        <span
          className={`relative grid size-12 shrink-0 place-items-center rounded-full ${TONE_RING[tone]} ${
            PENDING.includes(stage) && stage !== 'awaiting' ? 'animate-halo' : ''
          }`}
        >
          {stage === 'verified' ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
              <path d="m9 12 2.2 2.2L15.5 10" className="animate-draw" />
            </svg>
          ) : (
            <Icon name={ICON[stage]} size={24} />
          )}
        </span>
        <div className="min-w-0 pt-0.5" role="status" aria-live={stage === 'failed' || stage === 'unresolved' ? 'assertive' : 'polite'}>
          <h2 id="journey-title" className={`text-[1.3125rem] font-semibold leading-tight tracking-tight ${TONE_TITLE[tone]}`}>
            {copy.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{copy.body}</p>
          {audienceNote !== undefined && <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{audienceNote}</p>}
        </div>
      </div>

      <JourneyTimeline stage={stage} />

      {stage === 'contract_paid' && <ProofLegend />}

      {counterpart !== null && (
        <p className="mt-4 flex items-start gap-2 text-sm text-[var(--text-secondary)]" data-testid="journey-counterpart">
          <span
            aria-hidden="true"
            className={`mt-1.5 size-2 shrink-0 rounded-full ${stage === 'awaiting' ? 'bg-[var(--text-muted)]' : 'bg-[var(--text-primary)]'}`}
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">{counterpart}</span>
        </p>
      )}
      {side === 'receiver' && context === 'pos' && stage === 'awaiting' && (
        <p className="mt-1 pl-4 text-xs text-[var(--text-muted)]">{j.counterpart.presenceGated}</p>
      )}
      {stage === 'awaiting' && code !== null && <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">{j.saleCodeHint}</p>}

      {footer !== undefined && <div className="mt-4">{footer}</div>}
    </section>
  );
}

function stageCopy(
  j: ReturnType<typeof useT>['commerce']['journey'],
  progress: Readonly<Record<ProgressStage, TitleBody>>,
  side: JourneySide,
  context: JourneyContext,
  stage: ProgressStage,
): TitleBody {
  if (side === 'receiver') {
    switch (stage) {
      case 'awaiting':
        return context === 'pos' ? j.receiver.awaitingSale : j.receiver.awaitingRequest;
      case 'transfer':
      case 'contract_paid':
      case 'verified':
        return j.receiver[stage];
      default:
        return progress[stage];
    }
  }
  switch (stage) {
    case 'awaiting':
      return context === 'checkout' ? j.payer.awaitingCheckout : j.payer.awaiting;
    case 'wallet':
    case 'transfer':
    case 'contract_paid':
    case 'verified':
      return j.payer[stage];
    default:
      return progress[stage];
  }
}

/** What the chain says about the other party. Never presence: that needs Handshake. */
function counterpartLine(
  j: ReturnType<typeof useT>['commerce']['journey'],
  side: JourneySide,
  context: JourneyContext,
  stage: ProgressStage,
  payerAccountId: string | null,
): string | null {
  const paidBy = payerAccountId === null ? j.counterpart.paymentSeen : fill(j.counterpart.paidBy, { account: payerAccountId });
  switch (stage) {
    case 'awaiting':
    case 'wallet':
      return side === 'receiver' ? j.counterpart.noPaymentYet : context === 'checkout' ? j.counterpart.merchantReady : j.counterpart.requesterReady;
    case 'transfer':
      return j.counterpart.paymentSeen;
    case 'contract_paid':
    case 'verified':
      return paidBy;
    default:
      return null;
  }
}

/** The receiving side of a live screen: the dot breathes while the chain is being re-read. */
function LivePill() {
  const t = useT();
  const j = t.commerce.journey;
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]" title={j.liveNote}>
      <span aria-hidden="true" className="relative grid size-2 place-items-center">
        <span className="journey-live-dot absolute inset-0 rounded-full bg-[var(--text-primary)]" />
        <span className="size-1.5 rounded-full bg-[var(--text-primary)]" />
      </span>
      {j.live}
      <span className="sr-only">. {j.liveNote}</span>
    </span>
  );
}

/** Six characters both phones derive from the request ID. Spelled out for screen readers. */
export function SaleCodeChip({ code, tone = 'dark' }: { readonly code: string; readonly tone?: 'dark' | 'paper' }) {
  const t = useT();
  const j = t.commerce.journey;
  const colors =
    tone === 'paper'
      ? 'border-[var(--ink-line)] bg-[var(--paper-shade)] text-[var(--ink)]'
      : 'border-[var(--border-strong)] bg-[rgb(244_243_232/0.05)] text-[var(--text-primary)]';
  return (
    <div className="relative shrink-0 text-right" data-testid="sale-code">
      <p className={`eyebrow ${tone === 'paper' ? 'text-[var(--ink-muted)]' : 'text-[var(--text-muted)]'}`}>{j.saleCode}</p>
      <p
        className={`relative mt-1 rounded-[10px] border px-2.5 py-1 font-mono text-base font-semibold tracking-[0.14em] ${colors}`}
        aria-label={`${j.saleCode}: ${code.split('').join(' ')}`}
      >
        <span aria-hidden="true">{groupCode(code)}</span>
        {/* "Recognized" ring: plays once as the session appears. */}
        <span aria-hidden="true" className="journey-connect pointer-events-none absolute inset-0 rounded-[10px] border-2 border-current" />
      </p>
    </div>
  );
}

const VISIBLE_STEP: Readonly<Record<StepKey, keyof ReturnType<typeof useT>['commerce']['journey']['steps']>> = {
  created: 'created',
  approved: 'approved',
  transfer: 'transfer',
  contract: 'contract',
  verified: 'verified',
};

/** Five nodes on one track. Each node keeps its full name and state for screen readers. */
export function JourneyTimeline({ stage, className = 'mt-5' }: { readonly stage: ProgressStage; readonly className?: string }) {
  const t = useT();
  // "Paid per contract": the receipt check does not run on this screen, so that
  // step reads "not yet" here, never "in progress".
  const base = stepsFor(stage);
  const steps = stage === 'contract_paid' ? { ...base, verified: 'todo' as const } : base;
  const reached = STEP_KEYS.reduce((last, key, i) => (steps[key] === 'done' || steps[key] === 'current' || steps[key] === 'failed' ? i : last), 0);
  const fillPct = (reached / (STEP_KEYS.length - 1)) * 100;
  return (
    <div className={`relative ${className}`}>
      {/* Track sits behind the node centres (each node is 1/5 of the width). */}
      <div aria-hidden="true" className="absolute left-[10%] right-[10%] top-[9px] h-0.5 rounded-full bg-[var(--border-strong)]">
        <div
          className={`journey-track-fill h-full rounded-full ${stage === 'verified' ? 'bg-[var(--taply-lime)]' : 'bg-[var(--text-primary)]'}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <ol className="relative grid grid-cols-5" aria-label={t.experience.progress.title}>
        {STEP_KEYS.map((key) => (
          <li key={key} className="flex min-w-0 flex-col items-center gap-1.5 text-center" data-state={steps[key]}>
            <Node state={steps[key]} verified={stage === 'verified' && key === 'verified'} />
            <span aria-hidden="true" className={`px-0.5 text-[10.5px] leading-tight ${LABEL[steps[key]]}`}>
              {t.commerce.journey.steps[VISIBLE_STEP[key]]}
            </span>
            <span className="sr-only">
              {t.experience.progress.steps[key]}: {t.experience.progress.stepState[steps[key]]}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const LABEL: Readonly<Record<StepState, string>> = {
  done: 'text-[var(--text-secondary)]',
  current: 'font-semibold text-[var(--text-primary)]',
  todo: 'text-[var(--text-muted)]',
  failed: 'font-semibold text-[var(--tone-caution-fg)]',
};

function Node({ state, verified }: { readonly state: StepState; readonly verified: boolean }) {
  if (state === 'done') {
    return (
      <span
        aria-hidden="true"
        className={`journey-node grid size-[18px] place-items-center rounded-full ${verified ? 'bg-[var(--taply-lime)] text-[var(--taply-night)]' : 'bg-[var(--text-primary)] text-[var(--surface-0)]'}`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span aria-hidden="true" className="journey-node journey-node-current relative grid size-[18px] place-items-center rounded-full bg-[var(--surface-1)] ring-2 ring-[var(--taply-gold)]">
        <span className="size-2 rounded-full bg-[var(--taply-gold)]" />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span aria-hidden="true" className="journey-node grid size-[18px] place-items-center rounded-full bg-[var(--taply-gold)] text-[11px] font-bold text-[var(--taply-night)]">
        !
      </span>
    );
  }
  return <span aria-hidden="true" className="journey-node size-[18px] rounded-full bg-[var(--surface-1)] ring-2 ring-[var(--border-strong)]" />;
}

/** "Paid per contract" is not "Verified Paid": both shown side by side, only one ticked. */
function ProofLegend() {
  const t = useT();
  const p = t.commerce.journey.proofLegend;
  return (
    <ul className="mt-4 flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[rgb(244_243_232/0.03)] p-3 text-sm" data-testid="proof-legend">
      <li className="flex items-center gap-2">
        <Icon name="check" size={16} className="shrink-0 text-[var(--text-primary)]" />
        <span>{p.contract}</span>
      </li>
      <li className="flex items-center gap-2 text-[var(--text-muted)]">
        <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-dashed border-[var(--border-strong)]" />
        <span>{p.verifiedPending}</span>
      </li>
    </ul>
  );
}
