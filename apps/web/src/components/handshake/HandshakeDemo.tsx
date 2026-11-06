'use client';

import { useId, useState } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { presentHandshake } from '@/lib/handshake/present';
import { fill } from '@/lib/i18n';
import { useT } from '@/lib/i18n/provider';
import { DEMO_NOW_NS, DEMO_TERMS, DEMO_TERMS_SUBSTITUTED, demoSession } from '@/lib/mock/handshake-demo';
import type { DemoStep } from '@/lib/mock/handshake-demo';
import { JourneyTimeline } from '@/components/experience/SharedSession';
import { ComparisonCode, DeviceFrame, HandshakeTerms, Presence } from './HandshakeParts';

const STEPS = ['create', 'join', 'compare', 'review', 'wallet'] as const;

/**
 * DEMO ONLY (`/demo/handshake`). A click-through of two devices pairing.
 *
 * It feeds synthetic data through the REAL presenter, so the code, the
 * mismatch block and the review gate behave exactly as the live flow will.
 * It never reaches a network, a wallet or a payment state: the last step
 * stops before payment and says why.
 */
export function HandshakeDemo() {
  const t = useT();
  const h = t.commerce.handshake;
  const d = t.commerce.demo;
  const confirmId = useId();
  const [step, setStep] = useState<DemoStep>(0);
  const [reviewed, setReviewed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [tampered, setTampered] = useState(false);

  const session = demoSession(step, reviewed);
  // Each phone derives its code from the terms IT read. "Substituted" = the
  // customer's phone was shown different terms than the merchant signed.
  const customerTerms = tampered ? DEMO_TERMS_SUBSTITUTED : DEMO_TERMS;
  const merchant = presentHandshake({ role: 'merchant', session, chainTerms: DEMO_TERMS, nowNs: DEMO_NOW_NS });
  const customer = presentHandshake({ role: 'customer', session, chainTerms: customerTerms, nowNs: DEMO_NOW_NS });
  const copy = d.steps[STEPS[step]];
  const jd = t.commerce.journey.demo;
  // Synthetic coordinated status for each phone (DEMO only; live presence needs Handshake).
  const merchantStatus = step === 0 ? jd.waitingCustomer : step === 4 ? jd.waitingWallet : jd.customerJoined;
  const customerStatus = step <= 1 ? jd.merchantReady : step === 4 ? jd.yourWallet : jd.reviewing;
  const demoStage = step === 4 ? 'wallet' : 'awaiting';
  const codeTone = (phase: string) => (phase === 'mismatch' ? 'mismatch' : step >= 2 ? 'match' : 'neutral');
  const blocked = customer.phase === 'mismatch';
  const canAdvance = step < 4 && !blocked && (step !== 3 || reviewed);

  const restart = () => {
    setStep(0);
    setReviewed(false);
    setChecked(false);
    setTampered(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <p
        role="note"
        className="flex items-center justify-center gap-2 rounded-full bg-[rgb(201_115_107/0.14)] px-3 py-1.5 text-center text-xs font-semibold text-[var(--tone-danger-fg)]"
      >
        <span aria-hidden="true" className="-rotate-6 rounded border-2 border-current px-1.5 text-[11px] font-bold tracking-[0.2em]">
          {d.badge}
        </span>
        {d.synthetic}
      </p>

      <div aria-live="polite">
        <p className="eyebrow text-[var(--text-muted)]">{fill(d.stepLabel, { n: String(step + 1), total: String(STEPS.length) })}</p>
        <h2 className="mt-1 text-lg font-semibold">{copy.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{copy.body}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DeviceFrame label={`${d.badge} · ${h.merchantSide}`}>
          <DemoStatus key={merchantStatus} text={merchantStatus} active={step > 0} />
          <Presence connected={merchant.counterpartConnected} onLabel={h.customerJoined} offLabel={h.waiting} />
          <HandshakeTerms terms={DEMO_TERMS} />
          <ComparisonCode code={merchant.code} tone={codeTone(merchant.phase)} />
          <JourneyTimeline stage={demoStage} className="mt-1" />
          {merchant.phase === 'reviewed' && (
            <p className="flex items-center gap-2 text-sm font-medium">
              <Icon name="check" size={16} className="text-[var(--taply-lime)]" />
              {h.reviewedByCustomer}
            </p>
          )}
        </DeviceFrame>

        <DeviceFrame label={`${d.badge} · ${h.customerSide}`}>
          {step === 0 ? (
            <div className="grid min-h-[180px] place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] text-[var(--text-muted)]">
              <Icon name="scan" size={36} />
            </div>
          ) : (
            <>
              <DemoStatus key={blocked ? 'mismatch' : customerStatus} text={blocked ? h.mismatch.title : customerStatus} active={!blocked} />
              <Presence connected={customer.counterpartConnected} onLabel={h.merchantPresent} offLabel={h.merchantDisconnected} />
              <HandshakeTerms terms={customerTerms} />
              <ComparisonCode code={customer.code} tone={codeTone(customer.phase)} />
              <JourneyTimeline stage={demoStage} className="mt-1" />
              {blocked && <InlineNotice copy={h.mismatch} tone="danger" live="assertive" />}
              {step >= 3 && !blocked && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={confirmId} className="flex min-h-[var(--tap-target)] items-start gap-3 text-sm">
                    <input
                      id={confirmId}
                      type="checkbox"
                      checked={checked}
                      disabled={reviewed}
                      onChange={(e) => setChecked(e.target.checked)}
                      className="mt-0.5 size-5 shrink-0 accent-[var(--taply-lime)]"
                    />
                    {h.reviewConfirm}
                  </label>
                  <p className="text-xs text-[var(--text-muted)]">{h.reviewNote}</p>
                  <Button variant="secondary" disabled={!checked || reviewed} onClick={() => setReviewed(true)}>
                    {reviewed ? (
                      <>
                        <Icon name="check" size={16} /> {h.reviewed}
                      </>
                    ) : (
                      h.markReviewed
                    )}
                  </Button>
                </div>
              )}
              {step === 4 && customer.customerMayProceed && (
                <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-dashed border-[var(--border-strong)] p-3">
                  <p className="text-sm font-medium">{h.readyToPay}</p>
                  {/* Inert on purpose: the demo never opens a wallet. */}
                  <p className="text-xs text-[var(--text-muted)]">{d.walletPlaceholder}</p>
                </div>
              )}
            </>
          )}
        </DeviceFrame>
      </div>

      {step === 2 && (
        <Button variant="ghost" onClick={() => setTampered((v) => !v)} aria-pressed={tampered}>
          <Icon name="alert" size={16} />
          {tampered ? d.undoMismatch : d.simulateMismatch}
        </Button>
      )}

      {step === 4 && <InlineNotice copy={{ title: d.badge, body: d.endNote }} tone="neutral" />}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" disabled={step === 0} onClick={() => setStep((s) => (s > 0 ? ((s - 1) as DemoStep) : s))}>
          <Icon name="arrow-left" size={16} />
          {d.back}
        </Button>
        {step < 4 ? (
          <Button className="flex-1" disabled={!canAdvance} onClick={() => setStep((s) => (s < 4 ? ((s + 1) as DemoStep) : s))}>
            {d.next}
            <Icon name="arrow-right" size={16} />
          </Button>
        ) : (
          <Button className="flex-1" onClick={restart}>
            <Icon name="refresh" size={16} />
            {d.restart}
          </Button>
        )}
      </div>

      <p className="px-1 text-xs leading-relaxed text-[var(--text-muted)]">{h.identityNote}</p>
    </div>
  );
}

/** One synthetic status headline per phone; re-keyed so each change animates in. */
function DemoStatus({ text, active }: { readonly text: string; readonly active: boolean }) {
  return (
    <p className="animate-page flex items-center gap-2 text-base font-semibold" data-testid="demo-status">
      <span aria-hidden="true" className="relative grid size-2.5 place-items-center">
        {active && <span className="journey-live-dot absolute inset-0 rounded-full bg-[var(--taply-gold)]" />}
        <span className={`size-2 rounded-full ${active ? 'bg-[var(--taply-gold)]' : 'bg-[var(--text-muted)]'}`} />
      </span>
      {text}
    </p>
  );
}
