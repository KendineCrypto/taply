'use client';

import { useId } from 'react';
import { AmountHero, Monogram, NetworkPill } from '@/components/experience/Basics';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useT } from '@/lib/i18n/provider';

/**
 * Send review and result, shared by the real /send screen and the /demo tour.
 *
 * `confirm.available` decides whether the confirm button can be pressed. The
 * real screen passes `false` until a direct-transfer signer exists and signing
 * is approved; the reason is always shown next to the disabled button.
 */
export function SendReview({
  recipientAccountId,
  amountYocto,
  confirm,
  onEdit,
}: {
  readonly recipientAccountId: string;
  readonly amountYocto: string;
  readonly confirm: { readonly available: true; readonly label: string; readonly onConfirm: () => void } | { readonly available: false };
  readonly onEdit: () => void;
}) {
  const t = useT();
  const s = t.walletUx.send;
  const reasonId = useId();
  return (
    <section className="surface-card flex flex-col gap-4 p-5" aria-labelledby="send-review-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="send-review-title" className="text-lg font-semibold">
          {s.reviewTitle}
        </h2>
        <NetworkPill />
      </div>
      <p className="eyebrow text-[var(--text-muted)]">{s.youSend}</p>
      <AmountHero baseUnits={amountYocto} />
      <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[rgb(244_243_232/0.04)] p-3">
        <Monogram accountId={recipientAccountId} />
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-muted)]">{t.experience.to}</p>
          <p className="chain-id text-[0.9375rem] font-semibold">{recipientAccountId}</p>
        </div>
      </div>
      <dl className="grid gap-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.common.network}</dt>
          <dd className="text-right">{t.app.networkBadge}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{s.walletAction}</dt>
          <dd className="text-right">{s.walletActionValue}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.experience.review.networkFee}</dt>
          <dd className="text-right text-[var(--text-secondary)]">{s.feeValue}</dd>
        </div>
      </dl>
      {confirm.available ? (
        <Button size="lg" block onClick={confirm.onConfirm}>
          <Icon name="wallet" size={18} />
          {confirm.label}
        </Button>
      ) : (
        <>
          <Button size="lg" block disabled aria-describedby={reasonId}>
            <Icon name="wallet" size={18} />
            {s.confirm}
          </Button>
          <p id={reasonId} className="text-sm leading-relaxed text-[var(--tone-caution-fg)]">
            {s.confirmUnavailable}
          </p>
        </>
      )}
      <Button variant="ghost" block onClick={onEdit}>
        {s.edit}
      </Button>
    </section>
  );
}

export type SendOutcome = 'pending' | 'success' | 'failed' | 'unknown';

const OUTCOME_STYLE: Readonly<Record<SendOutcome, { icon: IconName; ring: string; title: string }>> = {
  pending: {
    icon: 'clock',
    ring: 'bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)] ring-1 ring-[var(--tone-caution-border)] animate-halo',
    title: 'text-[var(--tone-caution-fg)]',
  },
  success: { icon: 'check', ring: 'bg-[var(--taply-lime)] text-[var(--taply-night)]', title: 'text-[var(--taply-lime)]' },
  failed: {
    icon: 'x',
    ring: 'bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)] ring-1 ring-[var(--tone-danger-border)]',
    title: 'text-[var(--tone-danger-fg)]',
  },
  unknown: {
    icon: 'alert',
    ring: 'bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)] ring-1 ring-[var(--tone-caution-border)]',
    title: 'text-[var(--tone-caution-fg)]',
  },
};

/** Result of a transfer the wallet signed. Only the demo can reach it in this build. */
export function SendResult({
  outcome,
  recipientAccountId,
  amountYocto,
}: {
  readonly outcome: SendOutcome;
  readonly recipientAccountId: string;
  readonly amountYocto: string;
}) {
  const t = useT();
  const copy = t.walletUx.send.status[outcome];
  const style = OUTCOME_STYLE[outcome];
  return (
    <section className="surface-hero flex flex-col items-center p-6 text-center" data-send-outcome={outcome}>
      <span className={`grid size-16 place-items-center rounded-full ${style.ring}`}>
        <Icon name={style.icon} size={30} />
      </span>
      <div role="status" aria-live={outcome === 'failed' || outcome === 'unknown' ? 'assertive' : 'polite'}>
        <h2 className={`mt-4 text-[1.375rem] font-semibold tracking-tight ${style.title}`}>{copy.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{copy.body}</p>
      </div>
      <AmountHero baseUnits={amountYocto} size="lg" className="mt-5 justify-center" />
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {t.experience.to} <span className="chain-id text-[var(--text-primary)]">{recipientAccountId}</span>
      </p>
    </section>
  );
}
