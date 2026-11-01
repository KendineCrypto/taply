'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { ContractConfig, CreateQuote, PreparedContractCall } from '@taply/near-client';
import { prepareCreateRequest } from '@taply/near-client';
import { AccountId, Amount } from '@/components/primitives/Amount';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { AmountHero, Monogram } from '@/components/experience/Basics';
import { Icon } from '@/components/shell/Icons';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { formatBaseUnits } from '@/lib/format/amount';
import { blockingCreations, latestRecentCreation, recheckDelayMs } from '@/lib/payments/creation-gate';
import { FUNDING_LIFETIMES, buildInstantTerms, newCreationNonce, validateRequestForm } from '@/lib/payments/create';
import type { FundingLifetime, RequestFormError } from '@/lib/payments/create';
import { usePayments } from '@/lib/payments/context';
import { chainFreshness, sameContractConfig } from '@/lib/payments/freshness';
import { buildPaymentView } from '@/lib/payments/intent';
import { isBlocking } from '@/lib/payments/journal';
import type { JournalEntry } from '@/lib/payments/journal';
import { dateToNs, reconcile, submitCall } from '@/lib/payments/submit';
import type { Reconciliation, SubmitResult } from '@/lib/payments/submit';
import { NEAR_NATIVE } from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';
import { useWallet } from '@/lib/wallet/provider';
import { ChainTime, PaymentsSetupNotice, RequestTermsPreview, SigningBlockNotice, SubmitResultNotice } from './PaymentParts';

type Step =
  | { readonly kind: 'form' }
  | { readonly kind: 'quoting' }
  | { readonly kind: 'review'; readonly terms: IntentTerms; readonly termsHash: string; readonly quote: CreateQuote; readonly config: ContractConfig }
  | { readonly kind: 'signing'; readonly terms: IntentTerms; readonly termsHash: string; readonly quote: CreateQuote; readonly config: ContractConfig };

/**
 * Create an Instant Pay request (UX_FLOWS screen 06). The connected account is
 * always the recipient. An unconfirmed earlier creation blocks a new one; once
 * the chain shows no effect, it can be re-signed with its ORIGINAL nonce and
 * terms, never re-minted.
 */
export function CreateRequest({
  variant = 'request',
  onStepChange,
}: {
  readonly variant?: 'request' | 'sale';
  /** Informational only (0 = amount, 1 = review): lets a wrapper show progress. */
  readonly onStepChange?: (step: 0 | 1) => void;
} = {}) {
  const t = useT();
  const { locale } = useLocale();
  const c = t.commerce;
  const sale = variant === 'sale';
  const router = useRouter();
  const { state: wallet, signAndSend } = useWallet();
  const { setup, check, signingBlock, journal, journalVersion, ensureFreshCheck, now } = usePayments();
  const ids = { amount: useId(), memo: useId(), payer: useId(), expiry: useId(), options: useId() };

  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [payer, setPayer] = useState('');
  const [lifetime, setLifetime] = useState<FundingLifetime>('15m');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [errors, setErrors] = useState<ReadonlyArray<RequestFormError>>([]);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [quoteError, setQuoteError] = useState<'failed' | 'nonce_consumed' | 'stale' | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pending, setPending] = useState<ReadonlyArray<{ entry: JournalEntry; state: Reconciliation }>>([]);
  // The newest recent creation that a finalized read shows OPEN and still payable.
  const [openSale, setOpenSale] = useState<JournalEntry | null>(null);
  // Bumped by a timer while the chain has not yet explained a creation.
  const [recheckPass, setRecheckPass] = useState(0);

  const creator = wallet.status === 'connected' ? wallet.session.accountId : null;
  const ready = setup.status === 'ready' && check.status === 'verified';
  const contractId = setup.status === 'ready' ? setup.contractId : null;
  // A review prepared for another account (the wallet switched or reconnected)
  // is never shown as "you" and never signed. It must be reviewed again.
  const staleReview = (step.kind === 'review' || step.kind === 'signing') && step.terms.creatorAccountId !== creator;

  const reviewing = (step.kind === 'review' || step.kind === 'signing') && !staleReview;
  useEffect(() => {
    onStepChange?.(reviewing ? 1 : 0);
  }, [reviewing, onStepChange]);

  // Unexplained creations by this account block new ones (API.md: never allocate
  // another intent on an unknown submission). Each is reconciled with the chain,
  // and re-checked on a bounded backoff while the chain has not caught up yet, so
  // a confirmed sale unblocks the next one without a reload.
  useEffect(() => {
    if (creator === null || setup.status !== 'ready' || journal === null || !journal.isReadable()) return;
    const all = journal.entries();
    const unresolved = blockingCreations(all, creator, setup.contractId);
    const latest = latestRecentCreation(all, creator, setup.contractId, Date.now());
    const toRead = latest === null || unresolved.some((e) => e.requestId === latest.requestId) ? unresolved : [...unresolved, latest];
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.all(
      toRead.map(async (entry) => {
        const read = await setup.reader.readPaymentRequest(entry.requestId);
        const view = buildPaymentView({ read, expectedContractId: setup.contractId, accountId: creator });
        const state = reconcile(entry, view, dateToNs(entry.startedAt));
        if (state === 'resolved' && isBlocking(entry)) await journal.update(entry, { phase: 'RESOLVED' }).catch(() => undefined);
        return { entry, state, view };
      }),
    ).then((results) => {
      if (!active) return;
      setPending(results.filter((r) => isBlocking(r.entry) && r.state !== 'resolved').map(({ entry, state }) => ({ entry, state })));
      const newest = latest === null ? undefined : results.find((r) => r.entry.requestId === latest.requestId);
      const open =
        newest !== undefined &&
        newest.view.kind === 'ok' &&
        newest.view.request.status === 'OPEN' &&
        BigInt(newest.view.observedAtNs) < BigInt(newest.view.request.terms.fundingExpiresAtNs);
      setOpenSale(open && newest !== undefined ? newest.entry : null);
      if (results.some((r) => isBlocking(r.entry) && r.state === 'pending')) {
        timer = setTimeout(() => setRecheckPass((n) => n + 1), recheckDelayMs(recheckPass));
      }
    });
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // journalVersion: re-check after wallet redirect recovery changed the journal.
  }, [creator, setup, journal, journalVersion, recheckPass]);

  if (wallet.status !== 'connected') {
    return (
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-[var(--text-secondary)]">{t.payment.create.connectFirst}</p>
        <WalletErrorNotice />
        {wallet.status !== 'disabled' && <ConnectWalletButton />}
      </Card>
    );
  }

  const setupNotice = <PaymentsSetupNotice />;
  if (setup.status !== 'ready') return setupNotice;

  const requestQuote = async (terms: IntentTerms, termsHash: string, config: ContractConfig) => {
    setQuoteError(null);
    setStep({ kind: 'quoting' });
    const read = await setup.reader.quoteCreateRequest(terms);
    const quote = read.observation.data;
    const block = read.observation.observedBlock;
    if (read.error !== null || quote === null || read.observation.assurance !== 'verified_final' || read.observation.source !== 'rpc') {
      setQuoteError(read.error?.contractCode === 'NONCE_CONSUMED' ? 'nonce_consumed' : 'failed');
      setStep({ kind: 'form' });
      return;
    }
    // A quote from an old final block is not a basis for signing.
    if (block === null || chainFreshness(block.timestampNs, now()) !== 'fresh') {
      setQuoteError('stale');
      setStep({ kind: 'form' });
      return;
    }
    setStep({ kind: 'review', terms, termsHash, quote, config });
  };

  const onReview = async () => {
    if (check.status !== 'verified' || creator === null) return;
    const validation = validateRequestForm({ amount, memo, payer }, creator);
    if (!validation.ok) {
      setErrors(validation.errors);
      // An error in an optional field must be visible, never hidden behind the toggle.
      if (validation.errors.some((e) => !e.startsWith('amount'))) setOptionsOpen(true);
      return;
    }
    setErrors([]);
    setQuoteError(null);
    // Re-verify the contract at a FRESH final block first: a long-open tab must
    // not anchor new terms (expiry) or capabilities to an old observation.
    setStep({ kind: 'quoting' });
    const fresh = await ensureFreshCheck();
    if (fresh === null) {
      setQuoteError('stale');
      setStep({ kind: 'form' });
      return;
    }
    // Expiry is anchored to the chain time of that verified read, never the browser clock.
    const { terms, termsHash } = buildInstantTerms({
      contractId: setup.contractId,
      creatorAccountId: creator,
      creationNonce: newCreationNonce(),
      form: validation.value,
      chainNowNs: fresh.observedAtNs,
      lifetime,
    });
    await requestQuote(terms, termsHash, fresh.config);
  };

  const onResume = async (entry: JournalEntry) => {
    if (entry.terms === null || journal === null) return;
    // The person chose to re-sign the SAME terms after the chain showed no effect.
    try {
      await journal.update(entry, { phase: 'RESOLVED' });
    } catch {
      return;
    }
    setPending((list) => list.filter((p) => p.entry.requestId !== entry.requestId));
    const fresh = await ensureFreshCheck();
    if (fresh === null) {
      setQuoteError('stale');
      return;
    }
    // The SAME journaled terms and nonce, never re-minted.
    await requestQuote(entry.terms, entry.termsHash, fresh.config);
  };

  const onDiscard = async (entry: JournalEntry) => {
    if (journal === null) return;
    try {
      await journal.update(entry, { phase: 'RESOLVED' });
    } catch {
      return;
    }
    setPending((list) => list.filter((p) => p.entry.requestId !== entry.requestId));
  };

  const onSign = async () => {
    if (step.kind !== 'review' || staleReview || check.status !== 'verified' || creator === null || signingBlock !== null) return;
    const reviewed = step;
    // Before the wallet opens: the contract must still verify at a fresh final
    // block, with the same config the quote was reviewed against, and the
    // reviewed terms must still be fundable. Otherwise the reviewed terms are
    // dropped (never edited) and a new explicit review is required.
    setStep({ ...reviewed, kind: 'signing' });
    const fresh = await ensureFreshCheck();
    if (
      fresh === null ||
      !sameContractConfig(fresh.config, reviewed.config) ||
      BigInt(fresh.observedAtNs) >= BigInt(reviewed.terms.fundingExpiresAtNs)
    ) {
      setResult(null);
      setQuoteError('stale');
      setStep({ kind: 'form' });
      return;
    }
    let call: PreparedContractCall;
    try {
      call = prepareCreateRequest({
        contractId: setup.contractId,
        config: fresh.config,
        terms: reviewed.terms,
        quote: reviewed.quote,
        signerAccountId: creator,
      });
    } catch {
      // The quote no longer matches the verified contract config: never sign it.
      setQuoteError('failed');
      setStep({ kind: 'form' });
      return;
    }
    const outcome = await submitCall({
      journal,
      call,
      signerAccountId: creator,
      requestId: reviewed.terms.id,
      termsHash: reviewed.termsHash,
      terms: reviewed.terms,
      signAndSend,
    });
    setResult(outcome);
    if (outcome.kind === 'submitted' || outcome.kind === 'unknown') {
      // The status page reads the chain and reconciles the journal entry.
      router.push(`/pay/${reviewed.terms.id}`);
      return;
    }
    setStep({ ...reviewed, kind: 'review' });
  };

  const memoField = (
    <Field
      id={ids.memo}
      label={sale ? c.sale.referenceLabel : t.payment.create.memoLabel}
      hint={sale ? c.sale.referenceHint : t.payment.create.memoHint}
      error={errorFor(errors, ['memo_too_long'], t.payment.create.errors)}
    >
      <textarea
        id={ids.memo}
        value={memo}
        rows={sale ? 1 : 2}
        onChange={(e) => setMemo(e.target.value)}
        className="taply-input"
        aria-describedby={`${ids.memo}-hint ${ids.memo}-error`}
        aria-invalid={errors.includes('memo_too_long') || undefined}
      />
    </Field>
  );

  // Only this account on this contract: another account's draft never blocks this one.
  const blockingDrafts = pending.filter(
    (p) => p.entry.signerAccountId === creator && p.entry.contractId === contractId && (p.state === 'pending' || p.state === 'may_reattempt'),
  );
  const saleLabel = (terms: IntentTerms) => {
    const amount = `${formatBaseUnits(terms.amountBaseUnits, NEAR_NATIVE.decimals, { locale, maxFractionDigits: 24 }).exact} ${NEAR_NATIVE.symbol}`;
    // Plain text only: the reference is untrusted.
    return terms.memo === '' ? amount : `${amount} · “${terms.memo}”`;
  };
  const readySale = sale && openSale !== null && openSale.signerAccountId === creator && openSale.contractId === contractId && !reviewing ? openSale : null;
  const summaryMemo = sale ? '' : memo;
  const optionsSummary =
    payer.trim() === '' && summaryMemo === ''
      ? fill(t.oneTap.request.defaults, { expiry: t.payment.create.expiry[lifetime] })
      : [payer.trim() === '' ? t.oneTap.request.anyoneMayPay : payer.trim(), t.payment.create.expiry[lifetime], summaryMemo === '' ? null : `“${summaryMemo}”`]
          .filter((part) => part !== null)
          .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      {setupNotice}
      {check.status === 'checking' && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Spinner /> {t.payment.setup.checking}
        </p>
      )}

      {readySale !== null && readySale.terms !== null && (
        <InlineNotice
          tone="neutral"
          copy={{ title: c.sale.ready.title, body: fill(c.sale.ready.body, { sale: saleLabel(readySale.terms) }) }}
          action={
            <ButtonLink href={`/pay/${readySale.requestId}`} variant="secondary">
              {c.sale.showQr}
            </ButtonLink>
          }
        />
      )}

      {blockingDrafts.map(({ entry, state }) => (
        <InlineNotice
          key={entry.requestId}
          copy={
            !sale || entry.terms === null
              ? t.payment.create.pendingDraft
              : state === 'may_reattempt'
                ? { title: c.sale.pendingStale.title, body: fill(c.sale.pendingStale.body, { sale: saleLabel(entry.terms) }) }
                : { title: c.sale.pending.title, body: `${fill(c.sale.pending.body, { sale: saleLabel(entry.terms) })} ${c.sale.autoRecheck}` }
          }
          action={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/pay/${entry.requestId}`}>{t.payment.status.refresh}</ButtonLink>
              {state === 'may_reattempt' && entry.terms !== null && (
                <>
                  <Button variant="secondary" onClick={() => void onResume(entry)}>
                    {t.payment.create.resumeDraft}
                  </Button>
                  <Button variant="ghost" onClick={() => void onDiscard(entry)}>
                    {t.payment.create.discardDraft}
                  </Button>
                </>
              )}
            </div>
          }
        />
      ))}

      {staleReview && (
        <InlineNotice tone="caution" copy={{ title: c.accountChanged.title, body: fill(c.accountChanged.body, { account: step.terms.creatorAccountId }) }} />
      )}

      {(step.kind === 'form' || step.kind === 'quoting' || staleReview) && (
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void onReview();
          }}
        >
          <AmountField
            id={ids.amount}
            value={amount}
            onChange={setAmount}
            error={errorFor(errors, ['amount_required', 'amount_invalid', 'amount_zero'], t.payment.create.errors)}
          />

          {/* The recipient is always the connected account; it is never edited here. */}
          <p className="mx-auto flex max-w-full items-center gap-2 rounded-full bg-[var(--tone-neutral-bg)] py-1.5 pl-1.5 pr-3.5 text-sm">
            <Monogram accountId={creator ?? ''} size={26} />
            <span className="shrink-0 text-[var(--text-muted)]">{sale ? c.sale.receivingLabel : t.oneTap.request.toYou}</span>
            <span className="chain-id truncate font-medium" title={creator ?? ''}>
              {creator}
            </span>
          </p>

          {sale && memoField}

          <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)]">
            <button
              type="button"
              aria-expanded={optionsOpen}
              aria-controls={ids.options}
              onClick={() => setOptionsOpen((v) => !v)}
              className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2 text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.oneTap.request.moreOptions}</span>
                {!optionsOpen && <span className="block truncate text-xs text-[var(--text-muted)]">{optionsSummary}</span>}
              </span>
              <Icon name="chevron" size={18} className={`disclosure-chevron shrink-0 text-[var(--text-muted)] ${optionsOpen ? 'rotate-90' : ''}`} />
            </button>
            {optionsOpen && (
              <div id={ids.options} className="animate-page flex flex-col gap-4 border-t border-[var(--border-subtle)] px-4 pb-4 pt-4">
                {!sale && memoField}
                <Field id={ids.payer} label={t.payment.create.payerLabel} hint={t.payment.create.payerHint} error={errorFor(errors, ['payer_invalid', 'payer_is_recipient'], t.payment.create.errors)}>
                  <input
                    id={ids.payer}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={payer}
                    onChange={(e) => setPayer(e.target.value)}
                    className="taply-input chain-id"
                    aria-describedby={`${ids.payer}-hint ${ids.payer}-error`}
                    aria-invalid={errors.some((e) => e.startsWith('payer')) || undefined}
                  />
                </Field>
                <Field id={ids.expiry} label={t.payment.create.expiryLabel} hint={t.payment.create.expiryHint} error={null}>
                  <select
                    id={ids.expiry}
                    value={lifetime}
                    onChange={(e) => setLifetime(e.target.value as FundingLifetime)}
                    className="taply-input"
                    aria-describedby={`${ids.expiry}-hint`}
                  >
                    {(Object.keys(FUNDING_LIFETIMES) as FundingLifetime[]).map((key) => (
                      <option key={key} value={key}>
                        {t.payment.create.expiry[key]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>

          {quoteError !== null && (
            <InlineNotice
              copy={
                quoteError === 'nonce_consumed'
                  ? t.payment.create.nonceConsumed
                  : quoteError === 'stale'
                    ? t.reliability.reviewAgain
                    : t.payment.create.quoteFailed
              }
            />
          )}
          <Button type="submit" size="lg" block disabled={!ready || step.kind === 'quoting' || blockingDrafts.length > 0}>
            {step.kind === 'quoting' ? (
              <>
                <Spinner /> {t.payment.create.quoting}
              </>
            ) : (
              t.oneTap.request.continue
            )}
          </Button>
        </form>
      )}

      {(step.kind === 'review' || step.kind === 'signing') && !staleReview && (
        <section aria-labelledby="create-review-title" className="animate-page flex flex-col gap-5">
          <div>
            <h2 id="create-review-title" className="text-lg font-semibold">
              {t.payment.create.quoteTitle}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{t.oneTap.request.reviewBody}</p>
          </div>
          <div>
            <AmountHero baseUnits={step.terms.amountBaseUnits} size="lg" />
            {step.terms.memo !== '' && (
              // Plain text only: memos are untrusted and never rendered as HTML.
              <p className="mt-2 whitespace-pre-wrap break-words text-[var(--text-secondary)]">“{step.terms.memo}”</p>
            )}
          </div>
          <dl className="surface-card px-4 py-1">
            <DetailRow label={t.payment.review.recipient} emphasis>
              <span className="flex flex-col items-end">
                <AccountId accountId={step.terms.creatorAccountId} />
                <span className="text-xs font-normal text-[var(--text-muted)]">{t.payment.create.recipientIsYou}</span>
              </span>
            </DetailRow>
            <DetailRow label={t.oneTap.request.whoCanPay}>
              {step.terms.permittedPayerAccountId === null ? (
                t.oneTap.request.anyoneMayPay
              ) : (
                <AccountId accountId={step.terms.permittedPayerAccountId} />
              )}
            </DetailRow>
            <DetailRow label={t.oneTap.request.payableUntil}>
              <ChainTime ns={step.terms.fundingExpiresAtNs} />
            </DetailRow>
            <DetailRow label={t.common.network}>
              {t.app.networkBadge} · {t.mode.instant}
            </DetailRow>
            <DetailRow label={t.payment.create.storageBond} emphasis>
              <Amount baseUnits={step.quote.depositYocto} asset={NEAR_NATIVE} />
            </DetailRow>
            <DetailRow label={t.payment.create.gasLabel}>
              <span className="chain-id">{(BigInt(step.quote.gas) / 1_000_000_000_000n).toString()} Tgas</span>
            </DetailRow>
          </dl>
          <div className="-mt-2 flex flex-col gap-1 px-1">
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{t.payment.create.storageBondNote}</p>
            <p className="text-xs text-[var(--text-muted)]">{t.payment.create.gasNote}</p>
          </div>

          <details className="disclosure">
            <summary className="flex min-h-[var(--tap-target)] items-center justify-between gap-3 px-1 text-sm font-medium text-[var(--text-secondary)]">
              {t.oneTap.request.technical}
              <Icon name="chevron" size={16} className="disclosure-chevron shrink-0" />
            </summary>
            <div className="mt-2">
              <RequestTermsPreview terms={step.terms} />
            </div>
          </details>

          {sale && (
            <div className="flex flex-col gap-2" data-testid="sale-unbound">
              <InlineNotice copy={c.unbound} tone="neutral" />
              <p className="px-1 text-xs text-[var(--text-muted)]">{c.sale.uniqueNote}</p>
            </div>
          )}

          {result !== null && <SubmitResultNotice result={result} />}
          <div className="flex flex-col gap-1">
            {signingBlock !== null ? (
              <SigningBlockNotice block={signingBlock} />
            ) : (
              <Button size="lg" block onClick={() => void onSign()} disabled={step.kind === 'signing'}>
                {step.kind === 'signing' ? (
                  <>
                    <Spinner /> {t.payment.signing.waitingForWallet}
                  </>
                ) : (
                  t.payment.create.createInWallet
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              block
              disabled={step.kind === 'signing'}
              onClick={() => {
                setResult(null);
                setStep({ kind: 'form' });
              }}
            >
              {t.payment.create.edit}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Integer part + point + 24 decimals, with a little slack. */
const MAX_AMOUNT_CHARS = 36;

/**
 * The amount being typed must stay fully visible: a field that scrolls sideways
 * hides digits a merchant is about to charge. Long values step the font down
 * instead (the review step still shows the exact amount before signing).
 */
const AMOUNT_SIZES = {
  hero: 'max-w-[78%] text-[3.5rem] min-[400px]:text-[4rem]',
  large: 'max-w-[78%] text-[2.5rem] min-[400px]:text-[2.75rem]',
  medium: 'max-w-[82%] text-[1.625rem] min-[400px]:text-[1.875rem]',
  small: 'max-w-[90%] text-[0.875rem]',
} as const;

/** The NEAR suffix shrinks with the figure so long values keep their room. */
const SUFFIX_SIZES = { hero: 'text-2xl', large: 'text-2xl', medium: 'text-lg', small: 'text-xs' } as const;

export function amountSizeStep(length: number): keyof typeof AMOUNT_SIZES {
  if (length <= 7) return 'hero';
  if (length <= 11) return 'large';
  if (length <= 18) return 'medium';
  return 'small';
}

/** Amount-first input: one large field, the only mandatory one. */
function AmountField({
  id,
  value,
  onChange,
  error,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | null;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-2 pt-2 text-center">
      <label htmlFor={id} className="text-sm font-medium text-[var(--text-secondary)]">
        {t.payment.create.amountLabel}
      </label>
      <div className="flex w-full items-baseline justify-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder={t.experience.create.amountPlaceholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          size={Math.max(1, Math.min(value.length || 1, MAX_AMOUNT_CHARS))}
          data-length={amountSizeStep(value.length)}
          className={`display-amount min-h-[76px] bg-transparent text-center text-[var(--text-primary)] caret-[var(--taply-lime)] placeholder:text-[var(--text-muted)] focus-visible:outline-none ${AMOUNT_SIZES[amountSizeStep(value.length)]}`}
          aria-describedby={`${id}-hint ${id}-error`}
          aria-invalid={error !== null || undefined}
        />
        <span aria-hidden="true" className={`${SUFFIX_SIZES[amountSizeStep(value.length)]} shrink-0 font-semibold text-[var(--text-muted)]`}>
          NEAR
        </span>
      </div>
      <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
        {t.payment.create.amountHint}
      </p>
      <p id={`${id}-error`} className="min-h-5 text-sm text-[var(--tone-danger-fg)]" role={error === null ? undefined : 'alert'}>
        {error}
      </p>
    </div>
  );
}

function errorFor(
  errors: ReadonlyArray<RequestFormError>,
  keys: ReadonlyArray<RequestFormError>,
  copy: Readonly<Record<RequestFormError, string>>,
): string | null {
  const found = keys.find((key) => errors.includes(key));
  return found === undefined ? null : copy[found];
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly error: string | null;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
        {hint}
      </p>
      <p id={`${id}-error`} className="text-sm text-[var(--tone-danger-fg)]" role={error === null ? undefined : 'alert'}>
        {error}
      </p>
    </div>
  );
}
