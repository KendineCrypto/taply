'use client';

import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { encodeGiftSecret, newGiftLink, prepareCreateGift } from '@taply/near-client';
import type { GiftReader } from '@taply/near-client';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { NetworkPill } from '@/components/experience/Basics';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { useWalletMode } from '@/components/wallet/taply/mode';
import { useOptionalTaplyWallet } from '@/components/wallet/taply/TaplyWalletProvider';
import { ConnectWalletButton } from '@/components/wallet/WalletConnect';
import { recipientFormatCheck } from '@/components/send/SendFlow';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { useShareOrigin } from '@/lib/share/use-share-origin';
import { useWallet } from '@/lib/wallet/provider';
import { FLAGS } from '@/lib/flags/features';
import { GIFT_SETUP, defaultGiftReader, useGift, useGiftContract } from '@/lib/gift/hooks';
import type { GiftSetup } from '@/lib/gift/setup';
import { GIFT_DESIGNS, GIFT_LIFETIMES, MAX_GIFT_MESSAGE_BYTES, openGiftUrl, personalGiftUrl } from '@/lib/gift/link';
import type { GiftLifetime } from '@/lib/gift/link';
import { PERSONAL_MAX_YOCTO, PERSONAL_MIN_YOCTO, giftMessageError, messageBytes, validateGiftAmount } from '@/lib/gift/create';
import type { GiftAmountError } from '@/lib/gift/create';
import { saveGift } from '@/lib/gift/store';
import { submitGiftCall } from '@/lib/gift/submit';
import type { GiftSubmit } from '@/lib/gift/submit';
import { Envelope, EnvelopeSwatch } from './Envelope';
import { GiftShare } from './GiftShare';
import { GiftLetter } from './GiftLetter';

/**
 * /gift/new — five steps: type, amount, envelope, review, share.
 *
 * Personal Gift = a normal Taply Wallet transfer (reviewed backend +
 * confirmation dialog); the share link carries the message and the tx hash,
 * and the gift page re-checks that exact transfer on chain.
 *
 * Open Gift = `create_gift` on the separate gift contract. The gift id and the
 * one-off link key are generated here and saved on this device BEFORE the
 * wallet opens, so a reload never loses a funded gift's link, and repeating an
 * unknown attempt re-uses the same id (the contract refuses a second funding).
 */
type GiftType = 'personal' | 'open';
type Step = 1 | 2 | 3 | 4 | 5;
type Done =
  | { readonly kind: 'open'; readonly giftId: string; readonly url: string | null; readonly submit: GiftSubmit }
  | { readonly kind: 'personal'; readonly url: string | null; readonly txHash: string };

const NETWORK_FEE_ESTIMATE_YOCTO = '300000000000000000000'; // ~0.0003 NEAR measured (create 2.1 TGas)

export function GiftCreate({ setup = GIFT_SETUP, reader }: { readonly setup?: GiftSetup; readonly reader?: GiftReader | null }) {
  const giftReader = reader === undefined ? defaultGiftReader(setup) : reader;
  const t = useT();
  const g = t.gift;
  const { locale } = useLocale();
  const ids = { amount: useId(), recipient: useId(), message: useId() };
  const [mode] = useWalletMode();
  const taply = useOptionalTaplyWallet();
  const { state: wallet, signAndSend } = useWallet();
  const me = wallet.status === 'connected' ? wallet.session.accountId : null;
  const { check, ensureFresh } = useGiftContract(setup, setup.status === 'ready' ? giftReader : null);
  const shareOrigin = useShareOrigin();
  const origin = shareOrigin?.kind === 'ok' ? shareOrigin.origin : null;

  const [step, setStep] = useState<Step>(1);
  const [type, setType] = useState<GiftType | null>(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [design, setDesign] = useState(0);
  const [lifetime, setLifetime] = useState<GiftLifetime>('24h');
  const [amountError, setAmountError] = useState<GiftAmountError | 'recipient' | 'self' | 'mainnet' | 'missing' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'declined' | 'not_sent' | 'stale' | 'failed' | null>(null);
  const [personalReview, setPersonalReview] = useState<{ readonly depositYocto: string; readonly receiverId: string } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  /** A Personal Gift transfer whose outcome is unknown: never offered again blindly. */
  const [unknownTx, setUnknownTx] = useState<string | null | undefined>(undefined);

  const openReady = setup.status === 'ready' && check.status === 'verified' && check.gate.allowed;
  const taplyProvisioned = mode === 'taply' && taply?.state.status === 'provisioned';
  const personalReady = FLAGS.gift.enabled && taplyProvisioned;
  const config = check.status === 'verified' ? check.config : null;
  const minYocto = type === 'open' && config ? BigInt(config.minAmountYocto) : PERSONAL_MIN_YOCTO;
  const maxYocto = type === 'open' && config ? BigInt(config.maxAmountYocto) : PERSONAL_MAX_YOCTO;
  const feeYocto = type === 'open' && config ? BigInt(config.giftFeeYocto) : 0n;
  const availableYocto = taply?.state.status === 'provisioned' && mode === 'taply' ? BigInt(taply.state.balance.amountYocto) : null;
  const near = (yocto: string | bigint, digits = 5) => formatBaseUnits(yocto.toString(), 24, { locale, maxFractionDigits: digits }).display;
  const msgError = giftMessageError(message, config?.maxMessageBytes ?? MAX_GIFT_MESSAGE_BYTES);
  const parsedAmount = useMemo(
    () => validateGiftAmount(amount, { minYocto, maxYocto, extraYocto: feeYocto, availableYocto }),
    [amount, minYocto, maxYocto, feeYocto, availableYocto],
  );

  const goAmount = (next: GiftType) => {
    setType(next);
    setAmountError(null);
    setStep(2);
  };

  const continueFromAmount = () => {
    if (!parsedAmount.ok) {
      setAmountError(parsedAmount.error);
      return;
    }
    if (type === 'personal') {
      const format = recipientFormatCheck(recipient, me ?? '');
      if (format !== null) {
        setAmountError(format.kind === 'self' ? 'self' : format.kind === 'mainnet' ? 'mainnet' : 'recipient');
        return;
      }
    }
    setAmountError(null);
    setStep(3);
  };

  const continueToReview = async () => {
    if (msgError !== null) return;
    setNotice(null);
    if (type === 'personal' && taply !== null) {
      setBusy(true);
      const prepared = await taply.prepareSend(recipient.trim(), amount.trim().replace(',', '.'));
      setBusy(false);
      if (!prepared.ok) {
        setStep(2);
        setAmountError(prepared.code === 'INVALID_ADDRESS' ? 'missing' : prepared.code === 'INSUFFICIENT_AVAILABLE_BALANCE' ? 'balance' : 'recipient');
        return;
      }
      setPersonalReview({ depositYocto: prepared.value.depositYocto, receiverId: prepared.value.receiverId });
    }
    setStep(4);
  };

  const confirmOpen = async () => {
    if (me === null || !parsedAmount.ok || setup.status !== 'ready') return;
    setBusy(true);
    setNotice(null);
    try {
      const fresh = await ensureFresh();
      if (fresh === null) {
        setNotice('stale');
        return;
      }
      const link = await newGiftLink(globalThis.crypto);
      const secret = encodeGiftSecret(link.seed);
      let call;
      try {
        call = prepareCreateGift({ contractId: setup.contractId, config: fresh.config, signerAccountId: me, giftId: link.giftId,
          publicKeyHex: link.publicKeyHex, amountYocto: parsedAmount.yocto, lifetimeS: GIFT_LIFETIMES[lifetime], message, design });
      } catch {
        setNotice('stale');
        return;
      }
      const base = { kind: 'created' as const, id: link.giftId, secret, creator: me, amountYocto: parsedAmount.yocto, lifetimeS: GIFT_LIFETIMES[lifetime],
        message, design, savedAt: Date.now() };
      saveGift({ ...base, phase: 'draft', txHash: null });
      const submit = await submitGiftCall(signAndSend, call);
      if (submit.kind === 'declined' || submit.kind === 'not_sent') {
        saveGift({ ...base, phase: 'declined', txHash: null });
        setNotice(submit.kind);
        return;
      }
      saveGift({ ...base, phase: submit.kind, txHash: submit.transactionHash });
      setDone({ kind: 'open', giftId: link.giftId, url: origin === null ? null : openGiftUrl(origin, link.giftId, link.seed), submit });
      setStep(5);
    } finally {
      setBusy(false);
    }
  };

  const confirmPersonal = async () => {
    if (taply === null || personalReview === null || me === null) return;
    setBusy(true);
    setNotice(null);
    const result = await taply.sendNear(personalReview.receiverId, amount.trim().replace(',', '.'));
    setBusy(false);
    if (!result.ok) {
      setNotice('not_sent');
      return;
    }
    const outcome = result.value;
    if (outcome.kind === 'declined') {
      setNotice('declined');
      return;
    }
    if (outcome.kind === 'final' && !outcome.succeeded) {
      setNotice('failed');
      return;
    }
    if (outcome.kind === 'unknown') {
      setDone(null);
      setNotice(null);
      setUnknownTx(outcome.transactionHash);
      return;
    }
    const url = origin === null ? null : personalGiftUrl(origin, { v: 1, tx: outcome.transactionHash, from: me, to: personalReview.receiverId,
      amt: personalReview.depositYocto, msg: message, d: design });
    setDone({ kind: 'personal', url, txHash: outcome.transactionHash });
    setStep(5);
  };
  const steps = [g.steps.type, g.steps.amount, g.steps.message, g.steps.review, g.steps.share];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" aria-label={fill(g.stepOf, { n: String(step), total: '5' })}>
        <div className="gift-steps" aria-hidden="true">
          {steps.map((label, i) => (
            <span key={label} data-done={i < step ? 'true' : 'false'} />
          ))}
        </div>
        <p className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>{fill(g.stepOf, { n: String(step), total: '5' })} · {steps[step - 1]}</span>
          <NetworkPill />
        </p>
      </div>

      {step === 1 && (
        <section className="animate-page flex flex-col gap-3" aria-labelledby="gift-type-title">
          <h2 id="gift-type-title" className="text-xl font-semibold">{g.type.heading}</h2>
          <TypeCard
            icon="send"
            title={g.type.personal.label}
            body={g.type.personal.body}
            badge={g.type.personal.badge}
            disabled={!personalReady}
            note={!personalReady ? g.type.personalNeedsTaply : null}
            onSelect={() => goAmount('personal')}
          />
          <TypeCard
            icon="gift"
            title={g.type.open.label}
            body={g.type.open.body}
            badge={g.type.open.badge}
            primary
            disabled={!openReady}
            note={!openReady ? (setup.status === 'ready' && check.status === 'checking' ? g.claim.states.loading.title : g.type.openOff) : null}
            onSelect={() => goAmount('open')}
          />
        </section>
      )}

      {step === 2 && type !== null && (
        <section className="surface-card animate-page flex flex-col gap-5 p-5" aria-labelledby="gift-amount-title">
          <h2 id="gift-amount-title" className="text-xl font-semibold">{g.amount.heading}</h2>
          {type === 'personal' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={ids.recipient} className="text-sm font-medium">{g.amount.recipientLabel}</label>
              <input
                id={ids.recipient}
                className="taply-input chain-id"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="friend.testnet"
                aria-invalid={amountError === 'recipient' || amountError === 'self' || amountError === 'mainnet' || amountError === 'missing' || undefined}
              />
              <p className="text-xs text-[var(--text-muted)]">{g.amount.recipientHint}</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.amount} className="text-sm font-medium">{t.walletUx.send.amountLabel}</label>
            <div className="flex items-baseline gap-2 border-b-2 border-[var(--border-strong)] pb-2 focus-within:border-[var(--taply-lime)]">
              <input
                id={ids.amount}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountError(null);
                }}
                className="display-amount gift-amount-input min-h-[72px] w-full min-w-0 bg-transparent text-[3.25rem] placeholder:text-[var(--text-muted)] focus-visible:outline-none"
                aria-invalid={(amountError !== null && !['recipient', 'self', 'mainnet', 'missing'].includes(amountError)) || undefined}
                aria-describedby={`${ids.amount}-hint`}
              />
              <span aria-hidden="true" className="text-xl font-semibold text-[var(--text-secondary)]">NEAR</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label={g.amount.heading}>
              {['0.1', '0.5', '1', '5'].map((v) => (
                <button key={v} type="button" onClick={() => { setAmount(v); setAmountError(null); }}
                  className="pressable min-h-[36px] rounded-full border border-[var(--border-subtle)] px-3 text-sm font-medium hover:border-[var(--border-strong)]">
                  {v}
                </button>
              ))}
            </div>
            <p id={`${ids.amount}-hint`} className="text-xs text-[var(--text-muted)]">
              {fill(g.amount.limits, { min: near(minYocto, 3), max: near(maxYocto, 0) })}
              {availableYocto !== null && <> · {fill(g.amount.available, { amount: near(availableYocto, 4) })}</>}
            </p>
          </div>
          {amountError !== null && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{g.amount.errors[amountError]}</p>}
          <StepNav onBack={() => setStep(1)} onNext={continueFromAmount} />
        </section>
      )}

      {step === 3 && type !== null && (
        <section className="surface-card animate-page flex flex-col gap-5 p-5" aria-labelledby="gift-wrap-title">
          <h2 id="gift-wrap-title" className="text-xl font-semibold">{g.message.heading}</h2>
          <Envelope design={design} open label={g.envelope.openLabel}>
            <GiftLetter from={me ?? ''} amountYocto={parsedAmount.ok ? parsedAmount.yocto : '0'} message={message} status={null} />
          </Envelope>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.message} className="text-sm font-medium">{g.message.label}</label>
            <textarea
              id={ids.message}
              className="taply-input min-h-[96px] resize-none py-3"
              value={message}
              maxLength={MAX_GIFT_MESSAGE_BYTES}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={g.message.placeholder}
              aria-invalid={msgError !== null || undefined}
              aria-describedby={`${ids.message}-hint`}
            />
            <p id={`${ids.message}-hint`} className="flex justify-between gap-3 text-xs text-[var(--text-muted)]">
              <span>{type === 'open' ? g.message.publicNote : g.message.privateNote}</span>
              <span className={msgError === 'tooLong' ? 'text-[var(--tone-danger-fg)]' : ''}>
                {fill(g.message.counter, { used: String(messageBytes(message)), max: String(MAX_GIFT_MESSAGE_BYTES) })}
              </span>
            </p>
            {msgError !== null && <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">{g.message[msgError]}</p>}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{g.message.designLabel}</legend>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={g.message.designLabel}>
              {GIFT_DESIGNS.map((d) => (
                <button key={d.key} type="button" role="radio" aria-checked={design === d.id} className="gift-swatch flex flex-col items-center gap-1.5"
                  onClick={() => setDesign(d.id)}>
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
                {(Object.keys(GIFT_LIFETIMES) as GiftLifetime[]).map((key) => (
                  <button key={key} type="button" role="radio" aria-checked={lifetime === key} className="gift-swatch min-h-[44px] text-sm font-semibold"
                    onClick={() => setLifetime(key)}>
                    {g.message.lifetimes[key]}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">{g.message.lifetimeHint}</p>
            </fieldset>
          )}
          <StepNav onBack={() => setStep(2)} onNext={() => void continueToReview()} busy={busy} disabled={msgError !== null} />
        </section>
      )}

      {step === 4 && type !== null && parsedAmount.ok && (
        <section className="surface-hero animate-page flex flex-col gap-4 p-5" aria-labelledby="gift-review-title">
          <h2 id="gift-review-title" className="text-xl font-semibold">{g.review.heading}</h2>
          <div className="flex justify-center py-1">
            <div className="w-[46%]"><Envelope design={design} open={false} label={g.envelope.closedLabel} size="lg" /></div>
          </div>
          <dl className="text-sm">
            <Row label={g.review.txType} value={type === 'open' ? g.review.txOpen : g.review.txPersonal} />
            <Row label={g.review.sender} value={<span className="chain-id break-all">{me}</span>} />
            {type === 'open' && setup.status === 'ready' && <Row label={g.review.contract} value={<span className="chain-id break-all">{setup.contractId}</span>} />}
            {type === 'personal' && personalReview && <Row label={g.review.recipient} value={<span className="chain-id break-all">{personalReview.receiverId}</span>} />}
            <Row label={g.review.giftAmount} value={<strong>{near(type === 'personal' && personalReview ? personalReview.depositYocto : parsedAmount.yocto)} NEAR</strong>} />
            {type === 'open' && (
              <>
                <Row label={g.review.fee} value={<span>{near(feeYocto)} NEAR<span className="block text-xs text-[var(--text-muted)]">{g.review.feeNote}</span></span>} />
                <Row label={g.review.deposit} value={<strong>{near(BigInt(parsedAmount.yocto) + feeYocto)} NEAR</strong>} />
                <Row label={g.review.expires} value={g.message.lifetimes[lifetime]} />
              </>
            )}
            <Row label={g.review.networkFee} value={<span className="text-xs">{fill(g.review.networkFeeValue, { near: near(NETWORK_FEE_ESTIMATE_YOCTO, 4) })}</span>} />
            <Row label={t.common.network} value={t.app.networkBadge} />
          </dl>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{type === 'open' ? g.review.openRules : g.review.personalRules}</p>
          {type === 'open' && <p className="text-xs text-[var(--text-muted)]">{g.review.unreviewed}</p>}
          {notice !== null && <ResultNotice kind={notice} />}
          {unknownTx !== undefined && (
            <InlineNotice copy={{ title: g.result.unknown.title, body: `${g.result.unknown.body}${unknownTx ? ` · ${unknownTx}` : ''}` }} />
          )}
          {me === null ? (
            <ConnectWalletButton />
          ) : (
            <Button size="lg" block disabled={busy || unknownTx !== undefined} onClick={() => void (type === 'open' ? confirmOpen() : confirmPersonal())}>
              {busy ? <Spinner /> : <Icon name="shield" size={18} />}
              {busy ? g.review.confirming : g.review.confirm}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setStep(3)} disabled={busy}>
            <Icon name="arrow-left" size={16} /> {g.back}
          </Button>
        </section>
      )}

      {step === 5 && done !== null && (
        <Finished done={done} reader={giftReader} design={design} message={message} me={me ?? ''} amountYocto={parsedAmount.ok ? parsedAmount.yocto : '0'} />
      )}
    </div>
  );
}

function Finished({ done, reader, design, message, me, amountYocto }: {
  readonly done: Done; readonly reader: GiftReader | null; readonly design: number; readonly message: string; readonly me: string; readonly amountYocto: string;
}) {
  const t = useT();
  const g = t.gift;
  const live = useGift(done.kind === 'open' ? done.giftId : '0'.repeat(32), done.kind === 'open' ? reader : null);
  const onChain = done.kind === 'open' && live.read.status === 'ok' && live.read.gift !== null && live.read.gift.creator === me;
  const title = done.kind === 'personal' ? g.result.personalSent : onChain ? g.result.openReady : g.result.openWaiting;
  const body = done.kind === 'personal' ? g.result.personalSentBody : onChain ? g.result.openReadyBody : g.result.openWaitingBody;
  return (
    <div className="animate-page flex flex-col gap-4">
      <section className="surface-hero flex flex-col gap-4 p-5" aria-live="polite">
        <Envelope design={design} open label={g.envelope.openLabel}>
          <GiftLetter from={me} amountYocto={amountYocto} message={message} status={null} />
        </Envelope>
        <p className={`flex items-center gap-2 text-lg font-semibold ${done.kind === 'personal' || onChain ? 'text-[var(--taply-lime)]' : ''}`}>
          {done.kind === 'personal' || onChain ? <Icon name="check" size={20} /> : <Spinner />}
          {title}
        </p>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
        {done.kind === 'open' && done.submit.kind === 'unknown' && !onChain && <InlineNotice copy={g.result.unknown} />}
        {done.kind === 'open' && !onChain && (
          <Button variant="secondary" onClick={live.refresh}><Icon name="refresh" size={16} /> {g.result.recheck}</Button>
        )}
      </section>
      {done.url === null ? (
        <InlineNotice copy={{ title: g.share.heading, body: g.share.originUnavailable }} tone="neutral" />
      ) : (
        (done.kind === 'personal' || onChain) && <GiftShare url={done.url} kind={done.kind} />
      )}
    </div>
  );
}

function ResultNotice({ kind }: { readonly kind: 'declined' | 'not_sent' | 'stale' | 'failed' }) {
  const t = useT();
  const g = t.gift.result;
  if (kind === 'failed') return <InlineNotice copy={g.failed} />;
  if (kind === 'stale') return <InlineNotice copy={t.protectedFlow.staleReview} />;
  return <p role="status" className="text-sm text-[var(--text-secondary)]">{kind === 'declined' ? g.declined : g.notSent}</p>;
}

function Row({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0">
      <dt className="shrink-0 text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}

function StepNav({ onBack, onNext, busy = false, disabled = false }: { readonly onBack: () => void; readonly onNext: () => void; readonly busy?: boolean; readonly disabled?: boolean }) {
  const t = useT();
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={onBack} disabled={busy}>
        <Icon name="arrow-left" size={16} /> {t.gift.back}
      </Button>
      <Button block size="lg" onClick={onNext} disabled={busy || disabled}>
        {busy ? <Spinner /> : null} {t.gift.next} {!busy && <Icon name="arrow-right" size={18} />}
      </Button>
    </div>
  );
}

function TypeCard({ icon, title, body, badge, disabled, note, primary = false, onSelect }: {
  readonly icon: 'send' | 'gift'; readonly title: string; readonly body: string; readonly badge: string; readonly disabled: boolean;
  readonly note: string | null; readonly primary?: boolean; readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`pressable surface-card flex w-full items-start gap-4 p-5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        primary && !disabled ? 'border-[var(--tone-success-border)]' : ''
      } hover:border-[var(--border-strong)]`}
    >
      <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${primary ? 'bg-[var(--taply-lime)] text-[var(--taply-night)]' : 'bg-[var(--surface-2)]'}`}>
        <Icon name={icon} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{title}</span>
          <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{badge}</span>
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-[var(--text-secondary)]">{body}</span>
        {note !== null && <span className="mt-2 block text-xs text-[var(--tone-caution-fg)]">{note}</span>}
      </span>
      {!disabled && <Icon name="chevron" size={18} className="mt-1 shrink-0 text-[var(--text-muted)]" />}
    </button>
  );
}
