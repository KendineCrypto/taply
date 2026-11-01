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

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 pt-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md border-2 border-[var(--taply-clay)] px-2 py-0.5 text-xs font-bold tracking-[0.2em] text-[var(--taply-clay)]">
            {d.badge}
          </span>
          <span className="text-sm text-[var(--text-muted)]">{d.synthetic}</span>
        </div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{d.title}</h1>
        <p className="text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]">{d.intro}</p>
      </header>

      <nav aria-label={d.progressLabel}>
        <ol className="grid grid-cols-6 gap-1.5">
          {DEMO_STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => goTo(s)}
                aria-current={s === step ? 'step' : undefined}
                aria-label={`${i + 1}. ${d.steps[s].title}`}
                className="group flex w-full flex-col items-center gap-1.5 py-1"
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
          {d.steps[step].title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{d.steps[step].caption}</p>
      </div>

      <div key={step} className="animate-rise">
        {step === 'home' && <HomeStep onRequest={() => goTo('create')} />}
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

function DemoBanner() {
  const t = useT();
  return (
    <p className="mb-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] px-3 py-2 text-xs font-medium text-[var(--text-primary)]">
      <span className="rounded border border-[var(--taply-clay)] px-1 text-[10px] font-bold tracking-widest text-[var(--taply-clay)]">
        {t.experience.demo.badge}
      </span>
      {t.experience.demo.synthetic}
    </p>
  );
}

function HomeStep({ onRequest }: { readonly onRequest: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <section className="surface-hero p-5 pb-6" aria-label={t.experience.demo.balanceLabel}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-[var(--text-secondary)]">{t.experience.demo.balanceLabel}</p>
          <span className="rounded border border-[var(--taply-clay)] px-1.5 text-[10px] font-bold tracking-widest text-[var(--taply-clay)]">
            {t.experience.demo.badge}
          </span>
        </div>
        <AmountHero baseUnits={DEMO_BALANCE_YOCTO} className="mt-3" />
        <div className="mt-5 flex items-center gap-3">
          <Monogram accountId={DEMO_RECIPIENT} />
          <div className="min-w-0">
            <p className="text-xs text-[var(--text-muted)]">{t.experience.yourAccount}</p>
            <p className="chain-id font-medium">{DEMO_RECIPIENT}</p>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onRequest}
          className="pressable flex min-h-[64px] items-center justify-center gap-2.5 rounded-[var(--radius-card)] bg-[var(--taply-lime)] px-4 text-base font-semibold text-[var(--taply-night)] shadow-[0_14px_30px_-14px_rgb(199_252_117/0.6)] hover:bg-[#d4fd92]"
        >
          <Icon name="request" size={20} />
          {t.home.request}
        </button>
        <span className="flex min-h-[64px] items-center justify-center gap-2.5 rounded-[var(--radius-card)] border border-[var(--border-strong)] px-4 text-base font-semibold text-[var(--text-muted)]">
          <Icon name="send" size={20} />
          {t.home.send}
        </span>
      </div>
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
      <DemoBanner />
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
      <DemoBanner />
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
      <DemoBanner />
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
              className={`min-h-[36px] rounded-full border px-3 text-xs font-medium ${
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
