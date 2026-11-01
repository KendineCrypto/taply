'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { CreateQuote, PreparedContractCall } from '@taply/near-client';
import { prepareCreateRequest } from '@taply/near-client';
import { Amount } from '@/components/primitives/Amount';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { useT } from '@/lib/i18n/provider';
import { FUNDING_LIFETIMES, buildInstantTerms, newCreationNonce, validateRequestForm } from '@/lib/payments/create';
import type { FundingLifetime, RequestFormError } from '@/lib/payments/create';
import { usePayments } from '@/lib/payments/context';
import { buildPaymentView } from '@/lib/payments/intent';
import { isBlocking } from '@/lib/payments/journal';
import type { JournalEntry } from '@/lib/payments/journal';
import { dateToNs, reconcile, submitCall } from '@/lib/payments/submit';
import type { Reconciliation, SubmitResult } from '@/lib/payments/submit';
import { NEAR_NATIVE } from '@/lib/protocol';
import type { IntentTerms } from '@/lib/protocol';
import { useWallet } from '@/lib/wallet/provider';
import { PaymentsSetupNotice, RequestTermsPreview, SigningBlockNotice, SubmitResultNotice } from './PaymentParts';

type Step =
  | { readonly kind: 'form' }
  | { readonly kind: 'quoting' }
  | { readonly kind: 'review'; readonly terms: IntentTerms; readonly termsHash: string; readonly quote: CreateQuote }
  | { readonly kind: 'signing'; readonly terms: IntentTerms; readonly termsHash: string; readonly quote: CreateQuote };

/**
 * Create an Instant Pay request (UX_FLOWS screen 06). The connected account is
 * always the recipient. An unconfirmed earlier creation blocks a new one; once
 * the chain shows no effect, it can be re-signed with its ORIGINAL nonce and
 * terms, never re-minted.
 */
export function CreateRequest() {
  const t = useT();
  const router = useRouter();
  const { state: wallet, signAndSend } = useWallet();
  const { setup, check, signingBlock, journal, journalVersion } = usePayments();
  const ids = { amount: useId(), memo: useId(), payer: useId(), expiry: useId() };

  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [payer, setPayer] = useState('');
  const [lifetime, setLifetime] = useState<FundingLifetime>('15m');
  const [errors, setErrors] = useState<ReadonlyArray<RequestFormError>>([]);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [quoteError, setQuoteError] = useState<'failed' | 'nonce_consumed' | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pending, setPending] = useState<ReadonlyArray<{ entry: JournalEntry; state: Reconciliation }>>([]);

  const creator = wallet.status === 'connected' ? wallet.session.accountId : null;
  const ready = setup.status === 'ready' && check.status === 'verified';

  // Unexplained creations by this account block new ones (API.md: never allocate
  // another intent on an unknown submission). Each is reconciled with the chain.
  useEffect(() => {
    if (creator === null || setup.status !== 'ready' || journal === null || !journal.isReadable()) return;
    const unresolved = journal
      .entries()
      .filter((e) => e.method === 'create_request' && e.signerAccountId === creator && e.contractId === setup.contractId && isBlocking(e));
    if (unresolved.length === 0) return;
    let active = true;
    void Promise.all(
      unresolved.map(async (entry) => {
        const read = await setup.reader.readPaymentRequest(entry.requestId);
        const view = buildPaymentView({ read, expectedContractId: setup.contractId, accountId: creator });
        const state = reconcile(entry, view, dateToNs(entry.startedAt));
        if (state === 'resolved') journal.update(entry, { phase: 'RESOLVED' });
        return { entry, state };
      }),
    ).then((all) => {
      if (active) setPending(all.filter((p) => p.state !== 'resolved'));
    });
    return () => {
      active = false;
    };
    // journalVersion: re-check after wallet redirect recovery changed the journal.
  }, [creator, setup, journal, journalVersion]);

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

  const requestQuote = async (terms: IntentTerms, termsHash: string) => {
    setQuoteError(null);
    setStep({ kind: 'quoting' });
    const read = await setup.reader.quoteCreateRequest(terms);
    const quote = read.observation.data;
    if (read.error !== null || quote === null || read.observation.assurance !== 'verified_final' || read.observation.source !== 'rpc') {
      setQuoteError(read.error?.contractCode === 'NONCE_CONSUMED' ? 'nonce_consumed' : 'failed');
      setStep({ kind: 'form' });
      return;
    }
    setStep({ kind: 'review', terms, termsHash, quote });
  };

  const onReview = async () => {
    if (check.status !== 'verified' || creator === null) return;
    const validation = validateRequestForm({ amount, memo, payer }, creator);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors([]);
    // Expiry is anchored to the chain time of the verified config read, never the browser clock.
    const { terms, termsHash } = buildInstantTerms({
      contractId: setup.contractId,
      creatorAccountId: creator,
      creationNonce: newCreationNonce(),
      form: validation.value,
      chainNowNs: check.observedAtNs,
      lifetime,
    });
    await requestQuote(terms, termsHash);
  };

  const onResume = async (entry: JournalEntry) => {
    if (entry.terms === null || journal === null) return;
    // The person chose to re-sign the SAME terms after the chain showed no effect.
    journal.update(entry, { phase: 'RESOLVED' });
    setPending((list) => list.filter((p) => p.entry.requestId !== entry.requestId));
    await requestQuote(entry.terms, entry.termsHash);
  };

  const onDiscard = (entry: JournalEntry) => {
    journal?.update(entry, { phase: 'RESOLVED' });
    setPending((list) => list.filter((p) => p.entry.requestId !== entry.requestId));
  };

  const onSign = async () => {
    if (step.kind !== 'review' || check.status !== 'verified' || creator === null || signingBlock !== null) return;
    let call: PreparedContractCall;
    try {
      call = prepareCreateRequest({
        contractId: setup.contractId,
        config: check.config,
        terms: step.terms,
        quote: step.quote,
        signerAccountId: creator,
      });
    } catch {
      // The quote no longer matches the verified contract config: never sign it.
      setQuoteError('failed');
      setStep({ kind: 'form' });
      return;
    }
    setStep({ ...step, kind: 'signing' });
    const outcome = await submitCall({
      journal,
      call,
      signerAccountId: creator,
      requestId: step.terms.id,
      termsHash: step.termsHash,
      terms: step.terms,
      signAndSend,
    });
    setResult(outcome);
    if (outcome.kind === 'submitted' || outcome.kind === 'unknown') {
      // The status page reads the chain and reconciles the journal entry.
      router.push(`/pay/${step.terms.id}`);
      return;
    }
    setStep({ ...step, kind: 'review' });
  };

  const blockingDrafts = pending.filter((p) => p.state === 'pending' || p.state === 'may_reattempt');

  return (
    <div className="flex flex-col gap-4">
      {setupNotice}
      {check.status === 'checking' && (
        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Spinner /> {t.payment.setup.checking}
        </p>
      )}

      {blockingDrafts.map(({ entry, state }) => (
        <InlineNotice
          key={entry.requestId}
          copy={t.payment.create.pendingDraft}
          action={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/pay/${entry.requestId}`}>{t.payment.status.refresh}</ButtonLink>
              {state === 'may_reattempt' && entry.terms !== null && (
                <>
                  <Button variant="secondary" onClick={() => void onResume(entry)}>
                    {t.payment.create.resumeDraft}
                  </Button>
                  <Button variant="ghost" onClick={() => onDiscard(entry)}>
                    {t.payment.create.discardDraft}
                  </Button>
                </>
              )}
            </div>
          }
        />
      ))}

      {(step.kind === 'form' || step.kind === 'quoting') && (
        <Card as="section">
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void onReview();
            }}
          >
            <Field id={ids.amount} label={t.payment.create.amountLabel} hint={t.payment.create.amountHint} error={errorFor(errors, ['amount_required', 'amount_invalid', 'amount_zero'], t.payment.create.errors)}>
              <input
                id={ids.amount}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="taply-input"
                aria-describedby={`${ids.amount}-hint ${ids.amount}-error`}
                aria-invalid={errors.some((e) => e.startsWith('amount')) || undefined}
              />
            </Field>
            <Field id={ids.memo} label={t.payment.create.memoLabel} hint={t.payment.create.memoHint} error={errorFor(errors, ['memo_too_long'], t.payment.create.errors)}>
              <textarea
                id={ids.memo}
                value={memo}
                rows={2}
                onChange={(e) => setMemo(e.target.value)}
                className="taply-input"
                aria-describedby={`${ids.memo}-hint ${ids.memo}-error`}
                aria-invalid={errors.includes('memo_too_long') || undefined}
              />
            </Field>
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
            <dl>
              <DetailRow label={t.payment.create.recipientLabel}>
                <span className="flex flex-col items-end">
                  <span className="chain-id">{creator}</span>
                  <span className="text-xs text-[var(--text-muted)]">{t.payment.create.recipientIsYou}</span>
                </span>
              </DetailRow>
              <DetailRow label={t.common.mode}>{t.mode.instant}</DetailRow>
              <DetailRow label={t.common.network}>{t.app.networkBadge}</DetailRow>
            </dl>
            {quoteError !== null && (
              <InlineNotice copy={quoteError === 'nonce_consumed' ? t.payment.create.nonceConsumed : t.payment.create.quoteFailed} />
            )}
            <Button type="submit" size="lg" block disabled={!ready || step.kind === 'quoting' || blockingDrafts.length > 0}>
              {step.kind === 'quoting' ? (
                <>
                  <Spinner /> {t.payment.create.quoting}
                </>
              ) : (
                t.payment.create.getQuote
              )}
            </Button>
          </form>
        </Card>
      )}

      {(step.kind === 'review' || step.kind === 'signing') && (
        <>
          <h2 className="text-lg font-semibold">{t.payment.create.quoteTitle}</h2>
          <RequestTermsPreview terms={step.terms}>
            <DetailRow label={t.payment.create.storageBond} emphasis>
              <Amount baseUnits={step.quote.depositYocto} asset={NEAR_NATIVE} />
            </DetailRow>
            <DetailRow label={t.payment.create.gasLabel}>
              <span className="chain-id">{(BigInt(step.quote.gas) / 1_000_000_000_000n).toString()} Tgas</span>
            </DetailRow>
          </RequestTermsPreview>
          <p className="px-1 text-sm text-[var(--text-secondary)]">{t.payment.create.storageBondNote}</p>
          <p className="px-1 text-xs text-[var(--text-muted)]">{t.payment.create.gasNote}</p>
          {result !== null && <SubmitResultNotice result={result} />}
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
        </>
      )}
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
