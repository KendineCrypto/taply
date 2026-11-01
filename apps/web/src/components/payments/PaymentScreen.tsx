'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { prepareCancelUnfunded, preparePayInstantNative, prepareRetryNativeTransfer } from '@taply/near-client';
import type { ContractConfig, PreparedContractCall } from '@taply/near-client';
import { AccountId } from '@/components/primitives/Amount';
import { Button, ButtonLink, Spinner } from '@/components/primitives/Button';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { StatusBadge } from '@/components/status/StatusBadge';
import { PaymentProgress } from '@/components/experience/PaymentProgress';
import { progressStageFor } from '@/components/experience/progress';
import { ReviewSummary } from '@/components/experience/ReviewSummary';
import { Icon } from '@/components/shell/Icons';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { useT } from '@/lib/i18n/provider';
import { usePayments } from '@/lib/payments/context';
import { chainFreshness, sameContractConfig } from '@/lib/payments/freshness';
import type { PaymentView } from '@/lib/payments/intent';
import { isBlocking } from '@/lib/payments/journal';
import type { JournalEntry, JournalMethod } from '@/lib/payments/journal';
import { mapChainState } from '@/lib/payments/map-chain-state';
import type { MapInput } from '@/lib/payments/map-chain-state';
import { claimFollowUp, ownFundingAttempt, receiptPath, sessionFollowUpStorage } from '@/lib/payments/follow-up';
import { dateToNs, reconcile, submitCall } from '@/lib/payments/submit';
import { canonicalPayUrl } from '@/lib/share/origin';
import { useShareOrigin } from '@/lib/share/use-share-origin';
import type { Reconciliation, SubmitResult } from '@/lib/payments/submit';
import { usePaymentRequest } from '@/lib/payments/use-payment-request';
import { HashHexSchema } from '@/lib/protocol';
import type { ContractRequest } from '@/lib/protocol';
import { useNativeBalance } from '@/lib/near/use-native-balance';
import { displayableBalance } from '@/lib/near/balance';
import { useWallet } from '@/lib/wallet/provider';
import {
  ChainTime,
  PaymentsSetupNotice,
  Provenance,
  RequestTerms,
  ShareRequest,
  ShareUnavailable,
  SigningBlockNotice,
  SubmitResultNotice,
  TransactionLink,
} from './PaymentParts';

/** Conservative gas margin for the low-balance warning (50 Tgas at Testnet prices is far below this). */
const GAS_MARGIN_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

type Attempt = { readonly entry: JournalEntry; readonly state: Reconciliation };

/**
 * `/pay/[id]`: the single, role-aware view of one request (UX_FLOWS 07, 08,
 * 12-14, 17). Everything shown comes from a finalized `get_request` read of the
 * approved contract; the wallet result and local journal only add context.
 */
export function PaymentScreen({ id }: { readonly id: string }) {
  const t = useT();
  const { setup } = usePayments();
  const validId = HashHexSchema.safeParse(id).success;

  if (!validId) return <InlineNotice copy={t.payment.status.invalidId} tone="danger" />;
  if (setup.status !== 'ready') return <PaymentsSetupNotice />;
  return <PaymentLive id={id} />;
}

function PaymentLive({ id }: { readonly id: string }) {
  const t = useT();
  const { setup, check, journal, journalVersion, walletReturnsPending } = usePayments();
  const { state: wallet, signAndSend } = useWallet();
  const accountId = wallet.status === 'connected' ? wallet.session.accountId : null;
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [journalTick, setJournalTick] = useState(0);

  const entries = useMemo<JournalEntry[]>(() => {
    void journalTick;
    void journalVersion;
    if (journal === null || !journal.isReadable()) return [];
    return journal.forRequest(id);
  }, [journal, id, journalTick, journalVersion]);
  // Unexplained attempts keep the status polling until the chain explains them.
  const watchJournal = entries.some(isBlocking);
  const { view, loading, checkedAt, block, refresh, watching } = usePaymentRequest(id, watchJournal);

  // Reconcile journal entries against each new finalized read.
  const attempts = useMemo<Attempt[]>(() => {
    if (view === null) return [];
    return entries.map((entry) => ({ entry, state: reconcile(entry, view, dateToNs(entry.startedAt)) }));
  }, [entries, view]);
  // Persist what the chain explained, then re-read the journal (asynchronously,
  // so this effect never cascades renders) to stop polling for it.
  useEffect(() => {
    if (journal === null) return;
    const explained = attempts.filter(({ entry, state }) => state === 'resolved' && isBlocking(entry));
    if (explained.length === 0) return;
    let active = true;
    void Promise.allSettled(explained.map(({ entry }) => journal.update(entry, { phase: 'RESOLVED' }))).then(() => {
      if (active) setJournalTick((n) => n + 1);
    });
    return () => {
      active = false;
    };
  }, [attempts, journal]);

  // This device's own payment just became FINAL_PAID: open the receipt once,
  // with the funding hash it holds as a hint, so verification starts by itself.
  const router = useRouter();
  // A wallet-returned hash still being matched on chain is waited for, so it
  // travels with the receipt link.
  const matchingReturn = walletReturnsPending > 0 && setup.status === 'ready' && setup.verifierRpc !== null;
  useEffect(() => {
    if (view?.kind !== 'ok') return;
    const own = ownFundingAttempt(view.request, entries, Date.now());
    if (own === null || (own.transactionHash === null && matchingReturn) || !claimFollowUp(sessionFollowUpStorage(), own)) return;
    router.push(receiptPath(view.request, entries));
  }, [view, entries, router, matchingReturn]);

  const run = async (call: PreparedContractCall, request: ContractRequest, operationNonce?: string) => {
    if (accountId === null || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const outcome = await submitCall({
        journal,
        call,
        signerAccountId: accountId,
        requestId: request.terms.id,
        termsHash: request.termsHash,
        ...(operationNonce === undefined ? {} : { operationNonce }),
        signAndSend,
      });
      setResult(outcome);
    } finally {
      setSubmitting(false);
      setJournalTick((n) => n + 1);
      // Whatever the wallet said, the screen only believes the next finalized read.
      refresh();
    }
  };

  const allowReattempt = (method: JournalMethod) => {
    const attempt = attempts.find((a) => a.entry.method === method && a.state === 'may_reattempt');
    if (attempt === undefined || journal === null) return;
    // An explicit human decision after the chain showed no effect for 2+ minutes.
    void journal.update(attempt.entry, { phase: 'RESOLVED' }).then(
      () => {
        setResult(null);
        setJournalTick((n) => n + 1);
      },
      () => undefined,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PaymentsSetupNotice />
      <ViewBody
        id={id}
        view={view}
        accountId={accountId}
        attempts={attempts}
        result={result}
        submitting={submitting}
        onRun={run}
        onReattempt={allowReattempt}
        onRefresh={refresh}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {view !== null && <Provenance block={block} checkedAt={checkedAt} />}
        <Button variant="ghost" onClick={refresh} disabled={loading} className="-mr-2 px-2">
          {loading ? (
            <>
              <Spinner /> {t.payment.status.refreshing}
            </>
          ) : (
            <>
              <Icon name="refresh" size={16} /> {t.oneTap.payment.refresh}
            </>
          )}
        </Button>
      </div>
      {watching && view?.kind === 'ok' && <p className="-mt-2 px-1 text-xs text-[var(--text-muted)]">{t.payment.status.autoRefresh}</p>}
      {check.status === 'checking' && <p className="px-1 text-xs text-[var(--text-muted)]">{t.payment.setup.checking}</p>}
      {attempts.length > 0 && setup.status === 'ready' && (
        <details className="disclosure surface-card px-4 py-1">
          <summary className="flex min-h-[var(--tap-target)] items-center justify-between gap-3 text-sm font-medium">
            <span>{t.payment.status.yourAttempts}</span>
            <Icon name="chevron" size={16} className="disclosure-chevron shrink-0 text-[var(--text-muted)]" />
          </summary>
          <ul className="flex flex-col gap-2 pb-3 text-sm">
            {attempts.map(({ entry }) => (
              <li key={`${entry.method}:${entry.signerAccountId}`} className="flex flex-col gap-0.5">
                <span className="font-mono text-xs">
                  {entry.method} ·{' '}
                  {entry.phase === 'RESOLVED' ? t.payment.status.attemptResolved : t.localPhase[entry.phase].label}
                </span>
                {entry.transactionHash !== null && (
                  <TransactionLink explorerBaseUrl={setup.explorerBaseUrl} hash={entry.transactionHash} />
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ViewBody({
  id,
  view,
  accountId,
  attempts,
  result,
  submitting,
  onRun,
  onReattempt,
  onRefresh,
}: {
  readonly id: string;
  readonly view: PaymentView | null;
  readonly accountId: string | null;
  readonly attempts: ReadonlyArray<Attempt>;
  readonly result: SubmitResult | null;
  readonly submitting: boolean;
  readonly onRun: (call: PreparedContractCall, request: ContractRequest, operationNonce?: string) => Promise<void>;
  readonly onReattempt: (method: JournalMethod) => void;
  readonly onRefresh: () => void;
}) {
  const t = useT();
  if (view === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" role="status">
        <Spinner /> {t.common.loading}
      </p>
    );
  }
  switch (view.kind) {
    case 'unavailable':
      return (
        <InlineNotice
          copy={view.error === 'CONTRACT_CODE_MISMATCH' ? t.payment.setup.codeMismatch : t.payment.status.readFailed}
          tone={view.error === 'CONTRACT_CODE_MISMATCH' ? 'danger' : 'caution'}
        />
      );
    case 'not_found': {
      const creation = attempts.find((a) => a.entry.method === 'create_request' && isBlocking(a.entry));
      return (
        <InlineNotice
          copy={creation !== undefined ? t.payment.create.pendingDraft : t.payment.status.notFound}
          tone="neutral"
          action={creation !== undefined ? <ButtonLink href="/request/new">{t.payment.create.resumeDraft}</ButtonLink> : undefined}
        />
      );
    }
    case 'wrong_contract':
      return <InlineNotice copy={t.payment.status.wrongContract} tone="danger" />;
    case 'inconsistent':
      return <InlineNotice copy={t.payment.status.inconsistent} tone="danger" />;
    case 'ok':
      return (
        <RequestView
          id={id}
          view={view}
          accountId={accountId}
          attempts={attempts}
          result={result}
          submitting={submitting}
          onRun={onRun}
          onReattempt={onReattempt}
          onRefresh={onRefresh}
        />
      );
  }
}

function RequestView({
  id,
  view,
  accountId,
  attempts,
  result,
  submitting,
  onRun,
  onReattempt,
  onRefresh,
}: {
  readonly id: string;
  readonly view: Extract<PaymentView, { kind: 'ok' }>;
  readonly accountId: string | null;
  readonly attempts: ReadonlyArray<Attempt>;
  readonly result: SubmitResult | null;
  readonly submitting: boolean;
  readonly onRun: (call: PreparedContractCall, request: ContractRequest, operationNonce?: string) => Promise<void>;
  readonly onReattempt: (method: JournalMethod) => void;
  readonly onRefresh: () => void;
}) {
  const t = useT();
  const { setup, check, signingBlock, ensureFreshCheck, now } = usePayments();
  const { request, response, observedAtNs } = view;
  const input: MapInput = {
    state: request.status,
    observation: response.observation,
    derived: response.derived,
    fundingEligibility: response.fundingEligibility,
    incident: response.incident,
    // The receipt verifier runs on /receipt/[id]; this screen shows contract state only.
    settlementProof: 'contract_state_only',
  };
  const presentation = mapChainState(input);
  const copy = presentation.contractReportsPaid ? t.payment.contractPaid : t.status[request.status];
  const ctaKinds = new Set(presentation.ctas.map((c) => c.kind));
  // Contract state only on this screen: the receipt verifier runs on /receipt/[id].
  const stage = progressStageFor({
    state: request.status,
    incident: response.incident !== null,
    walletPending: submitting,
    verified: false,
  });
  const op = request.latestOperation;
  const role = response.derived.callerRole;

  const blockingFor = (method: JournalMethod) =>
    attempts.find((a) => a.entry.method === method && a.entry.signerAccountId === accountId && a.state !== 'resolved');

  // One canonical URL for QR, copy and share, on a public HTTPS origin only.
  const share = useShareOrigin();
  const link = share?.kind === 'ok' ? safePayLink(share.origin, id) : null;
  const config = check.status === 'verified' ? check.config : null;
  const contractId = setup.status === 'ready' ? setup.contractId : '';
  const [refused, setRefused] = useState(false);
  const [stale, setStale] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // Bumped when a review went stale, so the pay review (and its checkbox) starts over.
  const [reviewGeneration, setReviewGeneration] = useState(0);

  // Before any wallet prompt: the request read behind this screen must come from
  // a fresh final block, and the contract must verify again at a fresh block with
  // the same configuration the person saw. Otherwise re-read and ask for a new
  // review; never sign from an old observation.
  // near-client also refuses (throws) to describe a call the contract would reject.
  const attempt = async (make: (verified: ContractConfig) => PreparedContractCall, operationNonce?: string) => {
    if (verifying) return;
    setRefused(false);
    setStale(false);
    const reviewStale = () => {
      setStale(true);
      setReviewGeneration((g) => g + 1);
      onRefresh();
    };
    if (chainFreshness(observedAtNs, now()) !== 'fresh') {
      reviewStale();
      return;
    }
    setVerifying(true);
    const shown = config;
    const fresh = await ensureFreshCheck();
    setVerifying(false);
    if (fresh === null || shown === null || !sameContractConfig(fresh.config, shown)) {
      reviewStale();
      return;
    }
    let call: PreparedContractCall;
    try {
      call = make(fresh.config);
    } catch {
      setRefused(true);
      return;
    }
    void onRun(call, request, operationNonce);
  };

  return (
    <>
      {stage !== null ? (
        <PaymentProgress
          stage={stage}
          audienceNote={
            stage === 'contract_paid'
              ? t.payment.settlementProofPending
              : stage === 'unresolved'
                ? t.payment.status.unresolved.body
                : undefined
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
              <span className="text-xs text-[var(--text-muted)]">{t.experience.progress.contractStatus}</span>
              <StatusBadge {...input} />
            </div>
          }
        />
      ) : (
        <Card className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge {...input} />
            <span className="text-xs text-[var(--text-muted)]">{t.mode.instant}</span>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">{presentation.audience === 'recipient' ? copy.recipient : copy.payer}</p>
          {presentation.contractReportsPaid && <p className="text-xs text-[var(--text-muted)]">{t.payment.settlementProofPending}</p>}
        </Card>
      )}

      {/* The progress hero carries the unresolved state; the notice is the fallback for other modes. */}
      {response.incident !== null && stage === null && <InlineNotice copy={t.payment.status.unresolved} live="assertive" />}
      {request.status === 'PAYOUT_IN_FLIGHT' && response.incident === null && (
        <p className="px-1 text-sm text-[var(--tone-caution-fg)]">{t.payment.status.inFlightNote}</p>
      )}
      {request.status === 'PAYOUT_FAILED_RECOVERABLE' && (
        <p className="px-1 text-sm text-[var(--tone-caution-fg)]">
          {role === 'recipient' || role === 'payer_and_recipient' ? t.payment.status.failedRecipient : t.payment.status.failedPayer}
        </p>
      )}
      {response.fundingEligibility === 'EXPIRED' && <InlineNotice copy={t.payment.review.expired} tone="neutral" />}

      {result !== null && <SubmitResultNotice result={result} />}
      {refused && <InlineNotice copy={t.payment.status.inconsistent} tone="danger" />}
      {stale && <InlineNotice copy={t.reliability.reviewAgain} live="assertive" />}

      {ctaKinds.has('share_request') && link !== null && <ShareRequest link={link} request={request} />}
      {ctaKinds.has('share_request') && share?.kind === 'unavailable' && <ShareUnavailable reason={share.reason} requestId={id} />}

      {ctaKinds.has('review_and_pay') && (
        <PayReview
          key={reviewGeneration}
          request={request}
          observedAtNs={observedAtNs}
          accountId={accountId}
          blocking={blockingFor('pay_instant_native')}
          busy={submitting || verifying}
          onReattempt={() => onReattempt('pay_instant_native')}
          onPay={(signer) => {
            if (config === null) return;
            void attempt((verified) =>
              preparePayInstantNative({ contractId, config: verified, request, signerAccountId: signer, observedAtNs }),
            );
          }}
        />
      )}

      {ctaKinds.has('retry_same_operation') && op !== null && accountId !== null && (
        <OwnerAction
          title={t.payment.status.retryInWallet}
          note={t.payment.status.retryNote}
          blocking={blockingFor('retry_native_transfer')}
          signingBlock={signingBlock}
          busy={submitting || verifying}
          onReattempt={() => onReattempt('retry_native_transfer')}
          onConfirm={() => {
            if (config === null) return;
            void attempt(
              (verified) => prepareRetryNativeTransfer({ contractId, config: verified, request, signerAccountId: accountId }),
              op.nonce,
            );
          }}
        />
      )}

      {ctaKinds.has('cancel_unfunded') && accountId !== null && (
        <OwnerAction
          title={t.payment.status.cancelInWallet}
          note={t.payment.status.cancelNote}
          confirmLabel={t.payment.status.cancelConfirm}
          blocking={blockingFor('cancel_unfunded')}
          signingBlock={signingBlock}
          busy={submitting || verifying}
          onReattempt={() => onReattempt('cancel_unfunded')}
          onConfirm={() => {
            if (config === null) return;
            void attempt((verified) => prepareCancelUnfunded({ contractId, config: verified, request, signerAccountId: accountId }));
          }}
        />
      )}

      {ctaKinds.has('view_receipt') && (
        <ButtonLink href={receiptPath(request, attempts.map((a) => a.entry))} variant="primary" size="lg" block>
          {t.common.viewReceipt}
        </ButtonLink>
      )}

      <details className="disclosure">
        <summary className="flex min-h-[var(--tap-target)] items-center justify-between gap-3 px-1 text-sm font-medium text-[var(--text-secondary)]">
          {t.oneTap.payment.details}
          <Icon name="chevron" size={16} className="disclosure-chevron shrink-0" />
        </summary>
        <div className="mt-2">
          <RequestTerms request={request}>
            {request.payerAccountId !== null && (
              <DetailRow label={t.payment.status.payerLabel}>
                <AccountId accountId={request.payerAccountId} />
              </DetailRow>
            )}
            {request.fundedAtNs !== null && (
              <DetailRow label={t.payment.status.fundedAt}>
                <ChainTime ns={request.fundedAtNs} />
              </DetailRow>
            )}
            {op !== null && (
              <DetailRow label={t.payment.status.operationLabel}>
                <span className="chain-id">
                  #{op.nonce} · {t.payment.status.operationStatus[op.status]}
                </span>
              </DetailRow>
            )}
          </RequestTerms>
        </div>
      </details>
    </>
  );
}

function safePayLink(origin: string, id: string): string | null {
  try {
    return canonicalPayUrl(origin, id);
  } catch {
    return null;
  }
}

/** Attempt guard shared by every signing control. */
function AttemptGuard({ blocking, onReattempt }: { readonly blocking: Attempt | undefined; readonly onReattempt: () => void }) {
  const t = useT();
  if (blocking === undefined) return null;
  if (blocking.state === 'may_reattempt') {
    return (
      <InlineNotice
        copy={t.payment.signing.mayReattempt}
        action={
          <Button variant="secondary" onClick={onReattempt}>
            {t.payment.signing.reattempt}
          </Button>
        }
      />
    );
  }
  return <InlineNotice copy={t.payment.signing.blocked} />;
}

function PayReview({
  request,
  observedAtNs,
  accountId,
  blocking,
  busy,
  onReattempt,
  onPay,
}: {
  readonly request: ContractRequest;
  readonly observedAtNs: string;
  readonly accountId: string | null;
  readonly blocking: Attempt | undefined;
  readonly busy: boolean;
  readonly onReattempt: () => void;
  readonly onPay: (signer: string) => void;
}) {
  const t = useT();
  const { state: wallet } = useWallet();
  const { signingBlock, check, setup } = usePayments();
  const checkboxId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const balance = useNativeBalance(setup.status === 'ready' ? setup.reader : null, accountId);
  const verifiedBalance = displayableBalance(balance.view);

  // Whoever signs must also be someone the terms allow.
  const permitted = request.terms.permittedPayerAccountId;
  const notPermitted = accountId !== null && permitted !== null && permitted !== accountId;
  const self = accountId !== null && accountId === request.recipientAccountId;
  const amount = BigInt(request.terms.amountBaseUnits);
  const low = verifiedBalance !== null && BigInt(verifiedBalance.balance.amountYoctoNear) < amount + GAS_MARGIN_YOCTO;
  const stillOpen = BigInt(observedAtNs) < BigInt(request.terms.fundingExpiresAtNs);
  const payGas = check.status === 'verified' ? check.config.gas.payInstantNative : null;

  return (
    <Card as="section" className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-semibold">{t.payment.review.title}</h2>
      <p className="text-sm text-[var(--text-secondary)]">{t.payment.review.intro}</p>
      <ReviewSummary
        recipientAccountId={request.recipientAccountId}
        amountBaseUnits={request.terms.amountBaseUnits}
        contractId={request.terms.contractId}
        memo={request.terms.memo}
        payerAccountId={accountId}
        permittedPayerAccountId={request.terms.permittedPayerAccountId}
        payableUntil={stillOpen ? <ChainTime ns={request.terms.fundingExpiresAtNs} /> : null}
      />
      {payGas !== null && (
        <dl>
          <DetailRow label={t.payment.review.gasSeparate}>
            <span className="chain-id">{(BigInt(payGas) / 1_000_000_000_000n).toString()} Tgas</span>
          </DetailRow>
        </dl>
      )}
      <p className="text-xs text-[var(--text-muted)]">{t.payment.review.attachExactly}</p>

      {wallet.status !== 'connected' ? (
        <>
          <p className="text-sm text-[var(--text-secondary)]">{t.payment.review.connectToPay}</p>
          <WalletErrorNotice />
          {wallet.status !== 'disabled' && <ConnectWalletButton />}
        </>
      ) : notPermitted ? (
        <InlineNotice copy={t.payment.review.notPermittedPayer} tone="danger" />
      ) : self ? (
        <InlineNotice copy={t.payment.review.payingYourself} tone="neutral" />
      ) : (
        <>
          {low && <InlineNotice copy={t.payment.review.balanceLow} />}
          <AttemptGuard blocking={blocking} onReattempt={onReattempt} />
          {signingBlock !== null ? (
            <SigningBlockNotice block={signingBlock} />
          ) : (
            blocking === undefined &&
            stillOpen && (
              <>
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
                <Button
                  size="lg"
                  block
                  disabled={!confirmed || busy}
                  onClick={() => onPay(wallet.session.accountId)}
                >
                  {busy ? (
                    <>
                      <Spinner /> {t.payment.signing.waitingForWallet}
                    </>
                  ) : (
                    t.payment.review.approveInWallet
                  )}
                </Button>
              </>
            )
          )}
        </>
      )}
    </Card>
  );
}

function OwnerAction({
  title,
  note,
  confirmLabel,
  blocking,
  signingBlock,
  busy,
  onReattempt,
  onConfirm,
}: {
  readonly title: string;
  readonly note: string;
  readonly confirmLabel?: string;
  readonly blocking: Attempt | undefined;
  readonly signingBlock: ReturnType<typeof usePayments>['signingBlock'];
  readonly busy: boolean;
  readonly onReattempt: () => void;
  readonly onConfirm: () => void;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  return (
    <Card as="section" className="flex flex-col gap-3">
      <p className="text-sm text-[var(--text-secondary)]">{note}</p>
      <AttemptGuard blocking={blocking} onReattempt={onReattempt} />
      {signingBlock !== null ? (
        <SigningBlockNotice block={signingBlock} />
      ) : blocking === undefined ? (
        confirmLabel !== undefined && !armed ? (
          <Button variant="secondary" block onClick={() => setArmed(true)}>
            {title}
          </Button>
        ) : (
          <Button
            variant={confirmLabel !== undefined ? 'secondary' : 'primary'}
            block
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? (
              <>
                <Spinner /> {t.payment.signing.waitingForWallet}
              </>
            ) : (
              (confirmLabel ?? title)
            )}
          </Button>
        )
      ) : null}
    </Card>
  );
}
