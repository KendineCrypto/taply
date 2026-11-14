'use client';

import { ExternalWalletVerification } from './ExternalWalletVerification';

import { useId, useState } from 'react';
import { MainnetAccountSchema } from '@taply/shared';
import { Envelope, EnvelopeSwatch } from '@/components/gift/Envelope';
import { GiftLetter } from '@/components/gift/GiftLetter';
import { GiftRow, GiftSteps, StepNav, TypeCard } from '@/components/gift/GiftWizardParts';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { formatBaseUnits } from '@/lib/format/amount';
import { GIFT_DESIGNS } from '@/lib/gift/design';
import { fill } from '@/lib/i18n/fill';
import { useLocale, useT } from '@/lib/i18n/provider';
import { MAINNET_ASSETS, parseMainnetAmount } from '@/lib/mainnet/assets';
import { GIFT_PROFILE } from '@/lib/mainnet/gift-profile';
import { stableBusinessId } from '@/lib/mainnet/wallet-ops';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { GIFT_PAGES_COPY, hexOf } from './GiftPages';
import { newLinkKey } from './GiftMainnet';
import { LedgerPanel, OperationError, OperationReview, useOperation } from './Operation';
import { Notice } from './bits';
import { NoWalletCard } from './NoWalletCard';

/**
 * NEAR Mainnet gift creation in the Testnet five-step wizard (type, amount, envelope,
 * review, share). Personal Gift = Codex planner `nativeSend`; Open Gift = `giftCreate` on
 * the pinned Gift contract. The review is the Mainnet operation review; nothing is
 * signed before the person confirms it. Field ids match the earlier Mainnet forms.
 */
type GiftType = 'personal' | 'open';
type Step = 1 | 2 | 3 | 4 | 5;
const LIFETIMES = { '1h': 1, '24h': 24, '7d': 168 } as const;
type Lifetime = keyof typeof LIFETIMES;
const MAX_MESSAGE_BYTES = 280;
const PERSONAL_MAX_YOCTO = 1_000_000_000_000_000_000_000_000n; // contract cap: 1 NEAR per request

export function MainnetGiftWizard() {
  const t = useT();
  const g = t.gift;
  const { locale } = useLocale();
  const mLocale = useMainnetLocale().locale;
  const c = GIFT_PAGES_COPY[mLocale];
  const op = useOperation();
  const ids = { recipient: useId(), message: useId() };
  const [step, setStep] = useState<Step>(1);
  const [type, setType] = useState<GiftType | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [design, setDesign] = useState(0);
  const [lifetime, setLifetime] = useState<Lifetime>('24h');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; seedHex: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (op.signer.kind === 'external-no-key') return <ExternalWalletVerification />;
  if (op.signer.kind !== 'ok') return <NoWalletCard text={t.walletUx.send.connectFirst} />;
  const me = op.signer.accountId;
  const profile = GIFT_PROFILE;
  const near = (yocto: string | bigint, digits = 5) => formatBaseUnits(yocto.toString(), 24, { locale, maxFractionDigits: digits }).display;
  const parsed = parseMainnetAmount(amount, MAINNET_ASSETS.NEAR);
  const minYocto = type === 'open' && profile !== null ? BigInt(profile.contract.minAmountYocto) : 1n;
  const maxYocto = type === 'open' && profile !== null ? BigInt(profile.contract.maxAmountYocto) : PERSONAL_MAX_YOCTO;
  const feeYocto = profile !== null ? BigInt(profile.contract.giftFeeYocto) : 0n;
  const msgBytes = new TextEncoder().encode(message).length;
  const msgError = msgBytes > MAX_MESSAGE_BYTES ? g.message.tooLong : null;
  const reset = () => { op.reset(); setLink(null); setError(null); };
  const steps = [g.steps.type, g.steps.amount, g.steps.message, g.steps.review, g.steps.share];

  const continueFromAmount = () => {
    setError(null);
    if (type === 'personal') {
      const to = recipient.trim();
      if (!MainnetAccountSchema.safeParse(to).success) { setError(g.amount.errors.recipient); return; }
      if (to === me) { setError(g.amount.errors.self); return; }
    }
    if (amount.trim() === '') { setError(g.amount.errors.required); return; }
    if (!parsed.ok && parsed.reason !== 'cap') { setError(parsed.reason === 'precision' ? g.amount.errors.precision : g.amount.errors.invalid); return; }
    const yocto = parsed.ok ? BigInt(parsed.baseUnits) : maxYocto + 1n;
    if (yocto < minYocto) { setError(g.amount.errors.tooSmall); return; }
    if (yocto > maxYocto) { setError(g.amount.errors.tooLarge); return; }
    setStep(3);
  };

  const continueToReview = async () => {
    setError(null);
    if (msgError !== null || !parsed.ok) return;
    if (type === 'personal') {
      let businessId: string;
      try { businessId = stableBusinessId(window.localStorage, me, 'personal-gift'); } catch { setError(c.invalid); return; }
      const prepared = await op.run({ kind: 'nativeSend', receiverId: recipient.trim(), amountNear: amount.trim().replace(',', '.'), businessId });
      if (prepared !== null) setStep(4);
      return;
    }
    const key = await newLinkKey();
    const idBytes = new Uint8Array(16);
    crypto.getRandomValues(idBytes);
    const giftId = hexOf(idBytes);
    const seedHex = hexOf(key.seed);
    key.seed.fill(0);
    const prepared = await op.run({ kind: 'giftCreate', giftId, publicKeyHex: key.publicKeyHex, amountYocto: parsed.baseUnits, lifetimeS: LIFETIMES[lifetime] * 3600, message, design });
    if (prepared !== null) { setLink({ id: giftId, seedHex }); setStep(4); }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="gift-wizard">
      <GiftSteps step={step} labels={steps} />

      {step === 1 && (
        <section className="animate-page flex flex-col gap-3" aria-labelledby="gift-type-title">
          <h2 id="gift-type-title" className="text-xl font-semibold">{g.type.heading}</h2>
          <TypeCard
            icon="send"
            title={g.type.personal.label}
            body={g.type.personal.body}
            badge={g.type.personal.badge}
            disabled={false}
            note={null}
            onSelect={() => { setType('personal'); reset(); setStep(2); }}
          />
          <TypeCard
            icon="gift"
            title={g.type.open.label}
            body={g.type.open.body}
            badge={g.type.open.badge}
            primary
            disabled={profile === null}
            note={profile === null ? g.type.openOff : null}
            onSelect={() => { setType('open'); reset(); setStep(2); }}
          />
        </section>
      )}

      {step === 2 && type !== null && (
        <section className="surface-card animate-page flex flex-col gap-5 p-5" aria-labelledby="gift-amount-title">
          <h2 id="gift-amount-title" className="text-xl font-semibold">{g.amount.heading}</h2>
          {type === 'personal' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pg-to" className="text-sm font-medium">{g.amount.recipientLabel}</label>
              <input id="pg-to" className="taply-input chain-id" value={recipient} onChange={(e) => { setRecipient(e.target.value); reset(); }}
                autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="friend.near" />
              <p className="text-xs text-[var(--text-muted)]">{g.amount.recipientHint}</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={type === 'personal' ? 'pg-amount' : 'ogc-amount'} className="text-sm font-medium">{t.walletUx.send.amountLabel}</label>
            <div className="flex items-baseline gap-2 border-b-2 border-[var(--border-strong)] pb-2 focus-within:border-[var(--taply-lime)]">
              <input
                id={type === 'personal' ? 'pg-amount' : 'ogc-amount'}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); reset(); }}
                className="display-amount gift-amount-input min-h-[72px] w-full min-w-0 bg-transparent text-[3.25rem] placeholder:text-[var(--text-muted)] focus-visible:outline-none"
              />
              <span aria-hidden="true" className="text-xl font-semibold text-[var(--text-secondary)]">NEAR</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label={g.amount.heading}>
              {['0.1', '0.5', '1'].map((v) => (
                <button key={v} type="button" onClick={() => { setAmount(v); reset(); }}
                  className="pressable min-h-[36px] rounded-full border border-[var(--border-subtle)] px-3 text-sm font-medium hover:border-[var(--border-strong)]">
                  {v}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)]">{fill(g.amount.limits, { min: near(minYocto, 3), max: near(maxYocto, 0) })}</p>
          </div>
          {error !== null && <p role="alert" data-testid="gift-error" className="text-sm text-[var(--tone-danger-fg)]">{error}</p>}
          <StepNav onBack={() => setStep(1)} onNext={continueFromAmount} />
        </section>
      )}

      {step === 3 && type !== null && (
        <section className="surface-card animate-page flex flex-col gap-5 p-5" aria-labelledby="gift-wrap-title">
          <h2 id="gift-wrap-title" className="text-xl font-semibold">{g.message.heading}</h2>
          <Envelope design={design} open label={g.envelope.openLabel}>
            <GiftLetter from={me} amountYocto={parsed.ok ? parsed.baseUnits : '0'} message={message} status={null} />
          </Envelope>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={type === 'personal' ? 'pg-msg' : 'ogc-msg'} className="text-sm font-medium">{g.message.label}</label>
            <textarea
              id={type === 'personal' ? 'pg-msg' : 'ogc-msg'}
              className="taply-input min-h-[96px] resize-none py-3"
              value={message}
              maxLength={MAX_MESSAGE_BYTES}
              onChange={(e) => { setMessage(e.target.value); reset(); }}
              placeholder={g.message.placeholder}
              aria-describedby={`${ids.message}-hint`}
            />
            <p id={`${ids.message}-hint`} className="flex justify-between gap-3 text-xs text-[var(--text-muted)]">
              <span>{type === 'open' ? g.message.publicNote : g.message.privateNote}</span>
              <span className={msgError !== null ? 'text-[var(--tone-danger-fg)]' : ''}>{fill(g.message.counter, { used: String(msgBytes), max: String(MAX_MESSAGE_BYTES) })}</span>
            </p>
            {msgError !== null && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{msgError}</p>}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{g.message.designLabel}</legend>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={g.message.designLabel}>
              {GIFT_DESIGNS.map((d) => (
                <button key={d.key} type="button" role="radio" aria-checked={design === d.id} className="gift-swatch flex flex-col items-center gap-1.5" onClick={() => { setDesign(d.id); reset(); }}>
                  <EnvelopeSwatch design={d.id} />
                  <span className="text-xs font-medium">{g.message.designs[d.key]}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {type === 'open' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{g.message.lifetimeLabel}</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={g.message.lifetimeLabel}>
                {(Object.keys(LIFETIMES) as Lifetime[]).map((key) => (
                  <button key={key} type="button" role="radio" aria-checked={lifetime === key} className="gift-swatch min-h-[44px] text-sm font-semibold" onClick={() => { setLifetime(key); reset(); }}>
                    {g.message.lifetimes[key]}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">{g.message.lifetimeHint}</p>
            </fieldset>
          )}
          {error !== null && <p role="alert" data-testid="gift-error" className="text-sm text-[var(--tone-danger-fg)]">{error}</p>}
          <OperationError code={op.error} />
          {op.error === 'OUTCOME_UNRESOLVED' && <LedgerPanel onResolved={op.reset} />}
          <StepNav onBack={() => setStep(2)} onNext={() => void continueToReview()} busy={op.busy} disabled={msgError !== null} />
        </section>
      )}

      {step === 4 && type !== null && parsed.ok && op.prepared !== null && (
        <section className="surface-hero animate-page flex flex-col gap-4 p-5" aria-labelledby="gift-review-title" data-testid={type === 'personal' ? 'pg-review-card' : 'ogc-ready'}>
          <h2 id="gift-review-title" className="text-xl font-semibold">{g.review.heading}</h2>
          <div className="flex justify-center py-1">
            <div className="w-[46%]"><Envelope design={design} open={false} label={g.envelope.closedLabel} size="lg" /></div>
          </div>
          <dl className="text-sm">
            <GiftRow label={g.review.txType} value={type === 'open' ? g.review.txOpen : g.review.txPersonal} />
            <GiftRow label={g.review.sender} value={<span className="chain-id break-all">{me}</span>} />
            {type === 'personal' && <GiftRow label={g.review.recipient} value={<span className="chain-id break-all">{recipient.trim()}</span>} />}
            {type === 'open' && profile !== null && <GiftRow label={g.review.contract} value={<span className="chain-id break-all">{profile.contract.accountId}</span>} />}
            <GiftRow label={g.review.giftAmount} value={<strong>{near(parsed.baseUnits)} NEAR</strong>} />
            {type === 'open' && (
              <>
                <GiftRow label={g.review.fee} value={<span>{near(feeYocto)} NEAR<span className="block text-xs text-[var(--text-muted)]">{g.review.feeNote}</span></span>} />
                <GiftRow label={g.review.deposit} value={<strong data-testid="ogc-total">{near(BigInt(parsed.baseUnits) + feeYocto)} NEAR</strong>} />
                <GiftRow label={g.review.expires} value={g.message.lifetimes[lifetime]} />
              </>
            )}
            <GiftRow label={t.common.network} value={t.app.networkBadge} />
          </dl>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{type === 'open' ? g.review.openRules : g.review.personalRules}</p>
          {type === 'open' && <p className="text-xs text-[var(--text-muted)]">{g.review.unreviewed}</p>}
          <OperationReview
            compact
            prepared={op.prepared}
            title={type === 'open' ? c.createTitle : c.reviewTitle}
            onDone={(outcome) => { if (outcome.kind === 'FINAL_EXECUTION' && outcome.execution === 'SUCCESS') { setDone(outcome.transactionHash); setStep(5); } }}
          >
            {type === 'personal' && <p className="text-[12px] text-[var(--text-muted)]">{c.shareAfter}</p>}
          </OperationReview>
          <Button variant="ghost" onClick={() => { reset(); setStep(3); }}>
            <Icon name="arrow-left" size={16} /> {g.back}
          </Button>
        </section>
      )}

      {step === 5 && type !== null && (
        <section className="surface-card animate-page flex flex-col gap-4 p-5" aria-live="polite" data-testid="gift-done">
          <p className="flex items-center gap-2 font-semibold text-[var(--taply-lime)]">
            <Icon name="check" size={18} />
            {type === 'open' ? g.steps.share : t.walletNative.confirm.sent}
          </p>
          {type === 'open' && link !== null ? (
            <>
              <Notice tone="caution">{c.linkTitle}</Notice>
              <p data-testid="ogc-link" className="chain-id break-all rounded-[var(--radius-control)] bg-[var(--surface-2)] p-3 text-xs">{`${window.location.origin}/m/gift/${link.id}#k=${link.seedHex}`}</p>
            </>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">{c.shareAfter}</p>
          )}
          {done !== null && <p className="chain-id break-all text-xs text-[var(--text-muted)]">{done}</p>}
        </section>
      )}
    </div>
  );
}
