'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AmountHero, Monogram } from '@/components/experience/Basics';
import { PaymentProgress } from '@/components/experience/PaymentProgress';
import { ReceiptTicket } from '@/components/experience/ReceiptTicket';
import { RequestTicket } from '@/components/experience/RequestTicket';
import { ReviewSummary } from '@/components/experience/ReviewSummary';
import type { ProgressStage } from '@/components/experience/progress';
import { ShareActions } from '@/components/payments/PaymentParts';
import { SendResult, SendReview } from '@/components/send/SendParts';
import type { SendOutcome } from '@/components/send/SendParts';
import { ReceiveCard } from '@/components/wallet/ReceiveCard';
import { WalletKindBadge } from '@/components/wallet/WalletKind';
import { Amount } from '@/components/primitives/Amount';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import {
  DEMO_AMOUNT_NEAR,
  DEMO_BALANCE_YOCTO,
  DEMO_CONTRACT,
  DEMO_EXPIRES_AT_NS,
  DEMO_MEMO_EN,
  DEMO_MEMO_TR,
  DEMO_PAYER,
  DEMO_PROVIDER,
  DEMO_RECIPIENT,
  DEMO_REFERENCES,
  DEMO_SEND_AMOUNT_YOCTO,
  DEMO_SETTLED_AT_NS,
  DEMO_STEPS,
  DEMO_STORAGE_BOND_YOCTO,
  demoAmountToYocto,
  isDemoStep,
} from '@/lib/mock/demo-journey';
import type { DemoStep } from '@/lib/mock/demo-journey';
import { NEAR_NATIVE } from '@/lib/protocol';

/**
 * /demo product tour: the real Taply components, driven by deterministic DEMO
 * fixtures (lib/mock/demo-journey.ts). Nothing here opens a wallet, signs,
 * reads the chain or produces evidence. Every screen carries a DEMO marker,
 * and synthetic references never get explorer links.
 *
 * The current step lives in the URL (`?step=share`) so each screen can be
 * linked, reloaded, recorded and screenshotted directly.
 */

const STEP_EVENT = 'taply:demo-step';

function readStep(): DemoStep {
  const step = new URLSearchParams(window.location.search).get('step');
  return isDemoStep(step) ? step : 'home';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(STEP_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(STEP_EVENT, onChange);
  };
}

function goTo(step: DemoStep): void {
  const url = new URL(window.location.href);
  url.searchParams.set('step', step);
  window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(STEP_EVENT));
  document.getElementById('demo-step-title')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const STEP_ICON: Readonly<Record<DemoStep, IconName>> = {
  home: 'home',
  receive: 'receive',
  send: 'send',
  create: 'request',
  share: 'share',
  review: 'check',
  progress: 'clock',
  receipt: 'shield',
};

export function DemoTour() {
  const t = useT();
  const { locale } = useLocale();
  const step = useSyncExternalStore(subscribe, readStep, () => 'home' as DemoStep);
  const [amountText, setAmountText] = useState(DEMO_AMOUNT_NEAR);
  const amountYocto = demoAmountToYocto(amountText) ?? demoAmountToYocto(DEMO_AMOUNT_NEAR) ?? '1';
  const memo = locale === 'tr' ? DEMO_MEMO_TR : DEMO_MEMO_EN;
  const index = DEMO_STEPS.indexOf(step);
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => '',
  );
  const link = `${origin}/demo?step=review`;
  const d = t.experience.demo;
  const stepCopy = (s: DemoStep) =>
    s === 'receive' ? t.walletUx.demo.receive : s === 'send' ? t.walletUx.demo.send : d.steps[s];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 pt-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md border-2 border-[var(--taply-clay)] px-2 py-0.5 text-xs font-bold tracking-[0.2em] text-[var(--taply-clay)]">
            {d.badge}
          </span>
          <span className="text-sm text-[var(--text-muted)]">{d.synthetic}</span>
        </div>
        <h1 className="sr-only">{d.title}</h1>
      </header>

      <nav aria-label={d.progressLabel}>
        <ol className="grid grid-cols-8 gap-1">
          {DEMO_STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => goTo(s)}
                aria-current={s === step ? 'step' : undefined}
                aria-label={`${i + 1}. ${stepCopy(s).title}`}
                className="group flex min-h-[var(--tap-target)] w-full flex-col items-center justify-center gap-1.5 py-1"
              >
                <span
                  className={`h-1.5 w-full rounded-full transition-colors ${
                    i < index ? 'bg-[var(--text-secondary)]' : i === index ? 'bg-[var(--taply-lime)]' : 'bg-[var(--border-strong)]'
                  }`}
                />
                <Icon
                  name={STEP_ICON[s]}
                  size={16}
                  className={i === index ? 'text-[var(--taply-lime)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}
                />
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div>
        <p className="eyebrow text-[var(--text-muted)]">{fill(d.stepOf, { n: String(index + 1), total: String(DEMO_STEPS.length) })}</p>
        <h2 id="demo-step-title" tabIndex={-1} className="mt-2 text-xl font-semibold tracking-tight focus-visible:outline-none">
          {stepCopy(step).title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{stepCopy(step).caption}</p>
      </div>

      <div key={step} className="animate-rise">
        {step === 'home' && <HomeStep onGo={goTo} />}
        {step === 'receive' && <ReceiveCard demo accountId={DEMO_RECIPIENT} />}
        {step === 'send' && <SendStep />}
        {step === 'create' && (
          <CreateStep amountText={amountText} onAmount={setAmountText} amountYocto={amountYocto} memo={memo} onCreate={() => goTo('share')} />
        )}
        {step === 'share' && (
          <RequestTicket
            demo
            link={link}
            recipientAccountId={DEMO_RECIPIENT}
            amountBaseUnits={amountYocto}
            memo={memo}
            expiresAtNs={DEMO_EXPIRES_AT_NS}
            permittedPayerAccountId={null}
            actions={<ShareActions link={link} />}
          />
        )}
        {step === 'review' && <ReviewStep amountYocto={amountYocto} memo={memo} onApprove={() => goTo('progress')} />}
        {step === 'progress' && <ProgressStep onDone={() => goTo('receipt')} />}
        {step === 'receipt' && (
          <ReceiptTicket
            demo
            status="verified"
            amountBaseUnits={amountYocto}
            recipientAccountId={DEMO_RECIPIENT}
            payerAccountId={DEMO_PAYER}
            memo={memo}
            settledAtNs={DEMO_SETTLED_AT_NS}
            explorerBaseUrl={null}
            checkedVia={DEMO_PROVIDER}
            references={[
              { label: t.payment.verification.fundingTx, value: DEMO_REFERENCES.fundingTx },
              { label: t.payment.verification.transferReceipt, value: DEMO_REFERENCES.transferReceipt },
              { label: t.payment.verification.callbackReceipt, value: DEMO_REFERENCES.callbackReceipt },
              { label: t.payment.verification.stateBlock, value: DEMO_REFERENCES.stateBlock },
            ]}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" block disabled={index === 0} onClick={() => goTo(DEMO_STEPS[index - 1] ?? 'home')}>
          <Icon name="arrow-left" size={18} />
          {d.back}
        </Button>
        {index < DEMO_STEPS.length - 1 ? (
          <Button size="lg" block onClick={() => goTo(DEMO_STEPS[index + 1] ?? 'receipt')}>
            {d.next}
            <Icon name="arrow-right" size={18} />
          </Button>
        ) : (
          <Button size="lg" block onClick={() => goTo('home')}>
            <Icon name="refresh" size={18} />
            {d.restart}
          </Button>
        )}
      </div>
    </div>
  );
}


function HomeStep({ onGo }: { readonly onGo: (step: DemoStep) => void }) {
  const t = useT();
  const actions: ReadonlyArray<{ step: DemoStep; icon: IconName; label: string; primary: boolean }> = [
    { step: 'send', icon: 'send', label: t.home.send, primary: false },
    { step: 'receive', icon: 'receive', label: t.home.receive, primary: false },
    { step: 'create', icon: 'request', label: t.home.request, primary: true },
  ];
  return (
    <div className="flex flex-col gap-5">
      <section className="surface-hero p-5 pb-6" aria-label={t.experience.demo.balanceLabel}>
        <div className="mb-5 flex items-center gap-3">
          <Monogram accountId={DEMO_RECIPIENT} size={40} />
          <div className="min-w-0 flex-1">
            <p className="chain-id truncate text-[0.9375rem] font-semibold">{DEMO_RECIPIENT}</p>
            <WalletKindBadge kind="native" />
          </div>
          <span className="rounded border border-[var(--taply-clay)] px-1.5 text-[10px] font-bold tracking-widest text-[var(--taply-clay)]">
            {t.experience.demo.badge}
          </span>
        </div>
        <p className="text-sm font-medium text-[var(--text-secondary)]">{t.experience.demo.balanceLabel}</p>
        <AmountHero baseUnits={DEMO_BALANCE_YOCTO} className="mt-2" />
        <p className="mt-4 text-xs leading-relaxed text-[var(--text-muted)]">{t.walletUx.demo.conceptNote}</p>
      </section>
      <ul className="grid grid-cols-3 gap-3">
        {actions.map((a) => (
          <li key={a.step}>
            <button
              type="button"
              onClick={() => onGo(a.step)}
              className="pressable group flex w-full flex-col items-center gap-2 rounded-[var(--radius-card)] py-1 text-sm font-semibold"
            >
              <span
                className={`grid size-[60px] place-items-center rounded-full ${
                  a.primary
                    ? 'bg-[var(--taply-lime)] text-[var(--taply-night)] shadow-[0_12px_28px_-12px_rgb(199_252_117/0.65)]'
                    : 'bg-[var(--surface-2)] ring-1 ring-[var(--border-strong)]'
                }`}
              >
                <Icon name={a.icon} size={24} />
              </span>
              {a.label}
            </button>
          </li>
        ))}
      </ul>
      <section aria-label={t.walletUx.home.activityTitle}>
        <h3 className="mb-3 text-base font-semibold tracking-tight">{t.walletUx.home.activityTitle}</h3>
        <ul className="surface-card divide-y divide-[var(--border-subtle)] overflow-hidden">
          <DemoActivityRow
            icon="request"
            title={t.walletUx.activity.method.create_request}
            amount={demoAmountToYocto('12.5') ?? '1'}
            phase={t.walletUx.activity.phase.RESOLVED}
          />
          <DemoActivityRow
            icon="send"
            title={t.walletUx.activity.method.pay_instant_native}
            amount={DEMO_SEND_AMOUNT_YOCTO}
            phase={t.walletUx.activity.phase.SUBMITTED}
          />
        </ul>
      </section>
    </div>
  );
}

function DemoActivityRow({
  icon,
  title,
  amount,
  phase,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly amount: string;
  readonly phase: string;
}) {
  return (
    <li className="flex min-h-[64px] items-center gap-3 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] ring-1 ring-[var(--border-subtle)]">
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Amount baseUnits={amount} asset={NEAR_NATIVE} display="compact" className="text-sm font-semibold" />
        <span className="rounded-full bg-[var(--tone-neutral-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
          {phase}
        </span>
      </span>
    </li>
  );
}

const SEND_OUTCOMES: ReadonlyArray<SendOutcome> = ['pending', 'success', 'failed', 'unknown'];

function SendStep() {
  const t = useT();
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);

  useEffect(() => {
    if (outcome !== 'pending') return;
    const timer = setTimeout(() => setOutcome('success'), 1800);
    return () => clearTimeout(timer);
  }, [outcome]);

  return (
    <div className="flex flex-col gap-4">
      {outcome === null ? (
        <SendReview
          recipientAccountId={DEMO_PAYER}
          amountYocto={DEMO_SEND_AMOUNT_YOCTO}
          confirm={{ available: true, label: t.walletUx.demo.confirmDemo, onConfirm: () => setOutcome('pending') }}
          onEdit={() => setOutcome(null)}
        />
      ) : (
        <>
          <SendResult outcome={outcome} recipientAccountId={DEMO_PAYER} amountYocto={DEMO_SEND_AMOUNT_YOCTO} />
          <fieldset className="surface-card p-4">
            <legend className="sr-only">{t.walletUx.demo.showResult}</legend>
            <p className="mb-3 text-sm font-medium">{t.walletUx.demo.showResult}</p>
            <div className="flex flex-wrap gap-2">
              {SEND_OUTCOMES.map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={o === outcome}
                  onClick={() => setOutcome(o)}
                  className={`min-h-[var(--tap-target)] rounded-full border px-3 text-xs font-medium ${
                    o === outcome
                      ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--taply-night)]'
                      : 'border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t.walletUx.send.status[o].title}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOutcome(null)}
                className="min-h-[var(--tap-target)] rounded-full border border-[var(--border-strong)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {t.walletUx.send.edit}
              </button>
            </div>
          </fieldset>
        </>
      )}
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">{t.experience.demo.approveNote}</p>
    </div>
  );
}

function CreateStep({
  amountText,
  onAmount,
  amountYocto,
  memo,
  onCreate,
}: {
  readonly amountText: string;
  readonly onAmount: (value: string) => void;
  readonly amountYocto: string;
  readonly memo: string;
  readonly onCreate: () => void;
}) {
  const t = useT();
  const amountId = useId();
  const invalid = demoAmountToYocto(amountText) === null;
  return (
    <section className="surface-card flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={amountId} className="text-sm font-medium">
          {t.payment.create.amountLabel}
        </label>
        <div className="flex items-baseline gap-2 border-b-2 border-[var(--border-strong)] pb-2 focus-within:border-[var(--taply-lime)]">
          <input
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => onAmount(e.target.value)}
            aria-invalid={invalid || undefined}
            className="display-amount min-h-[64px] w-full min-w-0 bg-transparent text-[3rem] focus-visible:outline-none"
          />
          <span aria-hidden="true" className="text-xl font-semibold text-[var(--text-secondary)]">
            NEAR
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)]">{t.payment.create.amountHint}</p>
      </div>
      <dl className="grid gap-2.5 text-sm">
        <Row label={t.payment.create.memoLabel}>{memo}</Row>
        <Row label={t.payment.review.permittedPayer}>{t.payment.review.anyPayer}</Row>
        <Row label={t.payment.create.expiryLabel}>{t.payment.create.expiry['12h']}</Row>
        <Row label={t.payment.create.recipientLabel}>
          <span className="chain-id">{DEMO_RECIPIENT}</span>
        </Row>
        <Row label={t.payment.create.storageBond}>
          <Amount baseUnits={DEMO_STORAGE_BOND_YOCTO} asset={NEAR_NATIVE} />
        </Row>
        <Row label={t.experience.review.networkFee}>{t.experience.review.networkFeeValue}</Row>
      </dl>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">{t.payment.create.storageBondNote}</p>
      <Button size="lg" block disabled={invalid} onClick={onCreate}>
        {t.experience.demo.createDemo}
      </Button>
      <p className="sr-only" aria-live="polite">
        {invalid ? t.payment.create.errors.amount_invalid : amountYocto}
      </p>
    </section>
  );
}

function ReviewStep({ amountYocto, memo, onApprove }: { readonly amountYocto: string; readonly memo: string; readonly onApprove: () => void }) {
  const t = useT();
  const checkboxId = useId();
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="surface-card flex flex-col gap-4 p-5" aria-labelledby="demo-review-title">
      <h3 id="demo-review-title" className="text-lg font-semibold">
        {t.payment.review.title}
      </h3>
      <ReviewSummary recipientAccountId={DEMO_RECIPIENT} amountBaseUnits={amountYocto} contractId={DEMO_CONTRACT} memo={memo} />
      <label htmlFor={checkboxId} className="flex min-h-[var(--tap-target)] cursor-pointer items-center gap-3 text-sm">
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="size-5 accent-[var(--taply-lime)]"
        />
        {t.payment.review.confirmCheck}
      </label>
      <Button size="lg" block disabled={!confirmed} onClick={onApprove}>
        <Icon name="wallet" size={18} />
        {t.experience.demo.approveDemo}
      </Button>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">{t.experience.demo.approveNote}</p>
    </section>
  );
}

const PLAY_ORDER: ReadonlyArray<ProgressStage> = ['wallet', 'transfer', 'contract_paid', 'verified'];
const ALL_STAGES: ReadonlyArray<ProgressStage> = ['awaiting', 'wallet', 'transfer', 'contract_paid', 'verified', 'failed', 'unresolved'];

function ProgressStep({ onDone }: { readonly onDone: () => void }) {
  const t = useT();
  const [stage, setStage] = useState<ProgressStage>('wallet');
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const at = PLAY_ORDER.indexOf(stage);
    if (at < 0 || at === PLAY_ORDER.length - 1) return;
    const timer = setTimeout(() => setStage(PLAY_ORDER[at + 1] ?? 'verified'), 1800);
    return () => clearTimeout(timer);
  }, [playing, stage]);

  const finished = stage === 'verified';
  return (
    <div className="flex flex-col gap-4">
      <PaymentProgress
        stage={stage}
        footer={
          finished ? (
            <Button block onClick={onDone}>
              {t.common.viewReceipt}
              <Icon name="arrow-right" size={18} />
            </Button>
          ) : undefined
        }
      />
      <fieldset className="surface-card p-4">
        <legend className="sr-only">{t.experience.demo.showState}</legend>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t.experience.demo.showState}</p>
          <Button
            variant="ghost"
            className="-mr-2"
            onClick={() => {
              if (!playing && (stage === 'verified' || !PLAY_ORDER.includes(stage))) setStage('wallet');
              setPlaying((p) => !p);
            }}
          >
            <Icon name={playing ? 'clock' : 'refresh'} size={16} />
            {playing ? t.experience.demo.pause : t.experience.demo.play}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_STAGES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === stage}
              onClick={() => {
                setPlaying(false);
                setStage(s);
              }}
              className={`min-h-[var(--tap-target)] rounded-full border px-3 text-xs font-medium ${
                s === stage
                  ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--taply-night)]'
                  : 'border-[var(--border-strong)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.experience.progress.stages[s].title}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
