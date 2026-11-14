'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import {
  prepareCancelProtected,
  prepareFundProtectedNative,
  prepareReleaseProtected,
  prepareRetryProtectedTransfer,
  prepareTokenFunding,
} from '@taply/near-client';
import type { PreparedProtectedCall, PreparedTokenCall, ProtectedContractConfig, ProtectedReader } from '@taply/near-client';
import { displayAssetFor } from '@/lib/protected/assets';
import { AccountId, Amount } from '@/components/primitives/Amount';
import { Button, Spinner } from '@/components/primitives/Button';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { StatusBadge } from '@/components/status/StatusBadge';
import { Icon } from '@/components/shell/Icons';
import { ConnectWalletButton } from '@/components/wallet/WalletConnect';
import { ChainTime, ShareActions, SubmitResultNotice } from '@/components/payments/PaymentParts';
import { QrCode } from '@/components/payments/QrCode';
import { ReceiptTicket } from '@/components/experience/ReceiptTicket';
import type { ReceiptReference } from '@/components/experience/ReceiptTicket';
import { useShortDateTime } from '@/components/experience/Basics';
import { CHAIN_CONFIG } from '@/lib/near/config';
import { useShareOrigin } from '@/lib/share/use-share-origin';
import { durationSeconds, estimateCutoff, formatCountdown } from '@/lib/format/countdown';
import { fill } from '@/lib/i18n/fill';
import type { ProtectedFlowCopy } from '@/lib/i18n/protected-types';
import { useT } from '@/lib/i18n/provider';
import { usePayments } from '@/lib/payments/context';
import { chainFreshness, sameContractConfig } from '@/lib/payments/freshness';
import type { PaymentView } from '@/lib/payments/intent';
import { isBlocking } from '@/lib/payments/journal';
import type { JournalEntry, JournalMethod } from '@/lib/payments/journal';
import { mapChainState } from '@/lib/payments/map-chain-state';
import type { MapInput } from '@/lib/payments/map-chain-state';
import { dateToNs, reconcile, submitCall } from '@/lib/payments/submit';
import type { SubmitResult } from '@/lib/payments/submit';
import { HashHexSchema } from '@/lib/protocol';
import { PROTECTED_SETUP, defaultProtectedReader, useProtectedContract, useProtectedRequest } from '@/lib/protected/hooks';
import type { ProtectedSetup } from '@/lib/protected/setup';
import { useWallet } from '@/lib/wallet/provider';
import { useNativeBalance } from '@/lib/near/use-native-balance';
import { displayableBalance } from '@/lib/near/balance';

/** Conservative gas margin for the low-balance warning (same as Instant Pay). */
const GAS_MARGIN_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

/** Human duration for the signed cancellation window. */
export function windowLabel(cancelDurationNs: string, copy: ProtectedFlowCopy['duration']): string {
  const s = durationSeconds(cancelDurationNs);
  if (s % 3600 === 0) return fill(copy.hours, { n: String(s / 3600) });
  if (s >= 120 && s % 60 === 0) return fill(copy.minutes, { n: String(s / 60) });
  return fill(copy.seconds, { n: String(s) });
}

/** One quiet line instead of a notice card: the escrow is Testnet-only and not audited. */
export function UnreviewedLine() {
  const c = useT().protectedFlow;
  return (
    <p className="flex items-center gap-1.5 px-1 text-xs text-[var(--tone-caution-fg)]" role="note">
      <Icon name="alert" size={13} />
      {c.unreviewed.title} · {c.unreviewed.body}
    </p>
  );
}

export function ProtectedSetupNotice({ setup }: { readonly setup: ProtectedSetup }) {
  const c = useT().protectedFlow;
  switch (setup.status) {
    case 'flag_off':
      return <InlineNotice copy={c.notEnabled} tone="neutral" />;
    case 'not_configured':
      return <InlineNotice copy={c.notConfigured} tone="neutral" />;
    case 'invalid':
      return <InlineNotice copy={c.invalidConfig} tone="danger" />;
    case 'pilot_refused':
      return <InlineNotice copy={c.pilotRefused} tone="danger" />;
    case 'ready':
      return null;
  }
}

/**
 * `/protected/[id]`: one Protected request, every role and state. All state
 * comes from final, code-hash-anchored reads of the candidate contract; the
 * wallet result and local journal only add context and block duplicates.
 */
export function ProtectedScreen({
  id,
  setup = PROTECTED_SETUP,
  reader,
}: {
  readonly id: string;
  readonly setup?: ProtectedSetup;
  /** Tests inject a reader; the app uses the build's default. */
  readonly reader?: ProtectedReader | null;
}) {
  const c = useT().protectedFlow;
  if (setup.status !== 'ready') return <ProtectedSetupNotice setup={setup} />;
  if (!HashHexSchema.safeParse(id).success) return <InlineNotice copy={c.notFound} tone="neutral" />;
  return <ProtectedLive id={id} setup={setup} reader={reader === undefined ? defaultProtectedReader(setup) : reader} />;
}

type Ready = Extract<ProtectedSetup, { status: 'ready' }>;
type Notice = 'stale' | 'refused' | null;

function useNow(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

function ProtectedLive({ id, setup, reader }: { readonly id: string; readonly setup: Ready; readonly reader: ProtectedReader | null }) {
  const t = useT();
  const c = t.protectedFlow;
  const { journal, journalVersion } = usePayments();
  const { state: wallet, signAndSend } = useWallet();
  const accountId = wallet.status === 'connected' ? wallet.session.accountId : null;
  const { check, ensureFresh } = useProtectedContract(setup, reader);
  const { view, receivedAtMs, loading, refresh } = useProtectedRequest(id, reader, setup.contractId, accountId);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [journalTick, setJournalTick] = useState(0);

  const entries = useMemo<JournalEntry[]>(() => {
    void journalTick;
    void journalVersion;
    if (journal === null || !journal.isReadable()) return [];
    return journal.forRequest(id);
  }, [journal, id, journalTick, journalVersion]);
  const attempts = useMemo(
    () => (view === null ? [] : entries.map((entry) => ({ entry, state: reconcile(entry, view, dateToNs(entry.startedAt)) }))),
    [entries, view],
  );
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
  // This device sent a cancel for this account (anything but a local, never-dispatched decline).
  const cancelSent = entries.some(
    (e) => e.method === 'cancel_protected' && e.signerAccountId === accountId && !(e.phase === 'USER_REJECTED' && e.notDispatched === true),
  );
  const blocking = (method: JournalMethod) =>
    attempts.some((a) => a.entry.method === method && a.entry.signerAccountId === accountId && a.state !== 'resolved');

  const run = async (make: (config: ProtectedContractConfig) => PreparedProtectedCall | PreparedTokenCall, operationNonce?: string) => {
    if (view?.kind !== 'ok' || accountId === null || busy) return;
    setNotice(null);
    setResult(null);
    // Never sign from an old observation: the read behind this screen must be fresh,
    // and the contract must verify again with the same config the person saw.
    if (chainFreshness(view.observedAtNs, Date.now()) !== 'fresh') {
      setNotice('stale');
      refresh();
      return;
    }
    const shown = check.status === 'verified' ? check.config : null;
    setBusy(true);
    try {
      const fresh = await ensureFresh();
      if (fresh === null || shown === null || !fresh.gate.allowed || !sameContractConfig(fresh.config, shown)) {
        setNotice('stale');
        refresh();
        return;
      }
      let call: PreparedProtectedCall | PreparedTokenCall;
      try {
        call = make(fresh.config);
      } catch {
        setNotice('refused');
        return;
      }
      const outcome = await submitCall({
        journal,
        call,
        signerAccountId: accountId,
        requestId: view.request.terms.id,
        termsHash: view.request.termsHash,
        ...(operationNonce === undefined ? {} : { operationNonce }),
        signAndSend,
      });
      setResult(outcome);
    } finally {
      setBusy(false);
      setJournalTick((n) => n + 1);
      refresh();
    }
  };

  const gate = check.status === 'verified' ? check.gate : null;
  const canSign = gate !== null && gate.allowed;

  return (
    <div className="flex flex-col gap-4">
      {gate !== null && gate.allowed && gate.unreviewed && <UnreviewedLine />}
      {check.status === 'checking' && <p className="px-1 text-xs text-[var(--text-muted)]">{c.contractChecking}</p>}
      {(check.status === 'unreachable' || (gate !== null && !gate.allowed)) && <InlineNotice copy={c.contractBlocked} tone="neutral" />}
      <Body
        view={view}
        receivedAtMs={receivedAtMs}
        accountId={accountId}
        contractId={setup.contractId}
        balanceReader={reader?.client ?? null}
        config={check.status === 'verified' ? check.config : null}
        cancelSent={cancelSent}
        canSign={canSign}
        entries={entries}
        busy={busy}
        blocking={blocking}
        onRun={run}
      />
      {notice === 'stale' && <InlineNotice copy={c.staleReview} />}
      {notice === 'refused' && <InlineNotice copy={c.refused} />}
      {result !== null && <SubmitResultNotice result={result} />}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={refresh} disabled={loading} className="-mr-2 px-2">
          {loading ? <Spinner /> : <Icon name="refresh" size={16} />} {t.oneTap.payment.refresh}
        </Button>
      </div>
    </div>
  );
}

function Body({
  view,
  receivedAtMs,
  accountId,
  contractId,
  balanceReader,
  config,
  cancelSent,
  canSign,
  entries,
  busy,
  blocking,
  onRun,
}: {
  readonly view: PaymentView | null;
  readonly receivedAtMs: number | null;
  readonly accountId: string | null;
  readonly contractId: string;
  readonly balanceReader: ProtectedReader['client'] | null;
  readonly config: ProtectedContractConfig | null;
  readonly cancelSent: boolean;
  readonly canSign: boolean;
  readonly entries: ReadonlyArray<JournalEntry>;
  readonly busy: boolean;
  readonly blocking: (method: JournalMethod) => boolean;
  readonly onRun: (make: (config: ProtectedContractConfig) => PreparedProtectedCall | PreparedTokenCall, operationNonce?: string) => Promise<void>;
}) {
  const t = useT();
  const c = t.protectedFlow;
  const ackId = useId();
  const [ack, setAck] = useState(false);
  const locked = view?.kind === 'ok' && view.request.status === 'LOCKED';
  const now = useNow(1000, locked);
  const fundable = view?.kind === 'ok' && view.request.status === 'OPEN';
  const nativeAsset = view?.kind === 'ok' && view.request.terms.assetId === 'near:native';
  // Token balances are checked by the token contract itself; the NEAR balance only matters for native requests.
  const balance = useNativeBalance(fundable && nativeAsset ? balanceReader : null, accountId);
  const verifiedBalance = displayableBalance(balance.view);
  const share = useShareOrigin();

  if (view === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" role="status">
        <Spinner /> {t.common.loading}
      </p>
    );
  }
  if (view.kind === 'unavailable') return <InlineNotice copy={c.readFailed} />;
  if (view.kind === 'not_found') return <InlineNotice copy={c.notFound} tone="neutral" />;
  if (view.kind === 'wrong_contract') return <InlineNotice copy={c.wrongContract} tone="danger" />;
  if (view.kind === 'inconsistent') return <InlineNotice copy={c.inconsistent} tone="danger" />;

  const { request, response, observedAtNs } = view;
  const asset = displayAssetFor(request.terms.assetId, config);
  const isToken = request.terms.assetId !== 'near:native';
  // An asset the verified config does not name is never shown or paid as anything else.
  if (asset === null && config !== null) return <InlineNotice copy={c.unsupportedAsset} tone="danger" />;
  const input: MapInput = {
    state: request.status,
    observation: response.observation,
    derived: response.derived,
    fundingEligibility: response.fundingEligibility,
    incident: response.incident,
    // No independent Protected receipt verifier exists yet.
    settlementProof: 'contract_state_only',
  };
  const presentation = mapChainState(input);
  const ctas = new Set(presentation.ctas.map((x) => x.kind));
  const duration = request.terms.cancelDurationNs ?? '0';
  const role = response.derived.callerRole;
  const isRecipient = role === 'recipient' || role === 'payer_and_recipient';
  const canFund = ctas.has('review_and_pay') && !isRecipient;
  const op = request.latestOperation;
  const disabled = busy || !canSign || accountId === null;
  const permitted = request.terms.permittedPayerAccountId;
  const notPermitted = accountId !== null && permitted !== null && permitted !== accountId;
  const low =
    verifiedBalance !== null && BigInt(verifiedBalance.balance.amountYoctoNear) < BigInt(request.terms.amountBaseUnits) + GAS_MARGIN_YOCTO;
  // A cancel this device sent did not win: still LOCKED at a final block at/after the
  // cutoff, or the release branch was committed. The contract refused or will refuse it.
  const cutoffPassed = request.cancelUntilNs !== null && BigInt(observedAtNs) >= BigInt(request.cancelUntilNs);
  const cancelLost =
    cancelSent &&
    ((request.status === 'LOCKED' && cutoffPassed) ||
      request.status === 'RELEASE_IN_FLIGHT' ||
      request.status === 'RELEASE_FAILED_RECOVERABLE' ||
      request.status === 'FINAL_PAID');

  // Settled, native NEAR: the person gets a receipt instead of the working view.
  if (!isToken && (request.status === 'FINAL_PAID' || request.status === 'CANCELLED_REFUNDED')) {
    return <ProtectedReceipt request={request} entries={entries} contractId={contractId} />;
  }

  const countdown =
    locked && request.cancelUntilNs !== null && receivedAtMs !== null
      ? estimateCutoff({ cancelUntilNs: request.cancelUntilNs, observedAtNs, observedAtLocalMs: receivedAtMs, nowMs: now })
      : null;

  return (
    <>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge {...input} />
          <span className="text-xs text-[var(--text-muted)]">{t.mode.protected}</span>
        </div>
        {/* While locked, the LOCKED - NOT PAID panel below says it; no second sentence here. */}
        {!locked && (
          <p className="text-sm text-[var(--text-secondary)]">
            {presentation.audience === 'recipient' ? t.status[request.status].recipient : t.status[request.status].payer}
          </p>
        )}
        <dl>
          <DetailRow label={c.fields.amount} emphasis>
            {asset === null ? <Spinner /> : <Amount baseUnits={request.terms.amountBaseUnits} asset={asset} />}
          </DetailRow>
          <DetailRow label={c.fields.recipient}>
            <AccountId accountId={request.recipientAccountId} />
          </DetailRow>
          {request.payerAccountId !== null && (
            <DetailRow label={c.fields.payer}>
              <AccountId accountId={request.payerAccountId} />
            </DetailRow>
          )}
          <DetailRow label={c.fields.window}>{windowLabel(duration, c.duration)}</DetailRow>
          {request.status === 'OPEN' && (
            <DetailRow label={c.fields.fundingDeadline}>
              <ChainTime ns={request.terms.fundingExpiresAtNs} />
            </DetailRow>
          )}
          {request.cancelUntilNs !== null && (
            <DetailRow label={c.cutoffOnChain}>
              <ChainTime ns={request.cancelUntilNs} />
            </DetailRow>
          )}
        </dl>
      </Card>

      {locked && (
        <section
          aria-label={t.protectedPay.lockedNotPaid}
          className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-4"
        >
          <p className="flex items-center gap-2 text-base font-semibold tracking-wide text-[var(--tone-caution-fg)]">
            <Icon name="shield" size={18} /> {t.protectedPay.lockedNotPaid}
          </p>
          {countdown !== null && (
            <p className="text-sm text-[var(--text-primary)]" aria-live="off">
              {countdown.phase === 'open' ? fill(c.countdown, { time: formatCountdown(countdown.remainingMs) }) : c.countdownReached}
            </p>
          )}
          <p className="text-sm text-[var(--text-secondary)]">{c.rightsShort}</p>
        </section>
      )}

      {/* The recipient hands the open request to the payer: one link, one QR, ID only. */}
      {request.status === 'OPEN' && isRecipient && response.fundingEligibility !== 'EXPIRED' && share?.kind === 'ok' && (
        <div data-testid="protected-share">
          <Card className="flex flex-col items-center gap-3">
            <h2 className="self-start text-base font-semibold">{c.shareTitle}</h2>
            <p className="self-start text-sm leading-relaxed text-[var(--text-secondary)]">{c.shareBody}</p>
            <QrCode value={`${share.origin}/protected/${request.terms.id}`} label={c.shareQrLabel} />
            <div className="w-full">
              <ShareActions link={`${share.origin}/protected/${request.terms.id}`} />
            </div>
          </Card>
        </div>
      )}

      {canFund && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{c.consentTitle}</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            {fill(c.consentWithDuration, { duration: windowLabel(duration, c.duration) })}
          </p>
          <label htmlFor={ackId} className="flex min-h-[var(--tap-target)] items-start gap-3 text-sm">
            <input id={ackId} type="checkbox" className="mt-1 size-5 shrink-0" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{c.consentCheckbox}</span>
          </label>
          {notPermitted && <InlineNotice copy={t.errors.PAYER_MISMATCH} tone="danger" />}
          {low && !notPermitted && <InlineNotice copy={t.payment.review.balanceLow} />}
          {isToken && <p className="text-xs text-[var(--text-muted)]">{c.tokenNotes}</p>}
          {accountId === null ? (
            <ConnectWalletButton />
          ) : (
            <Button
              size="lg"
              block
              disabled={disabled || !ack || notPermitted || blocking(isToken ? 'ft_transfer_call' : 'fund_protected_native')}
              onClick={() =>
                void onRun((verified) =>
                  isToken
                    ? // NEP-141: ft_transfer_call on the allowlisted token; a refused transfer is returned in full.
                      prepareTokenFunding({ contractId, config: verified, request, signerAccountId: accountId, observedAtNs, acceptedCancelDurationNs: duration })
                    : prepareFundProtectedNative({
                        contractId,
                        config: verified,
                        request,
                        signerAccountId: accountId,
                        observedAtNs,
                        // Exactly what this screen showed; the builder refuses anything else.
                        acceptedCancelDurationNs: duration,
                      }),
                )
              }
            >
              {busy ? <Spinner /> : <Icon name="shield" size={18} />} {c.lockAction}
            </Button>
          )}
        </Card>
      )}

      {response.fundingEligibility === 'EXPIRED' && <InlineNotice copy={c.expired} tone="neutral" />}

      {(ctas.has('cancel_protected') || ctas.has('release_protected')) && (
        <div className="flex flex-col gap-2">
          {accountId === null && <ConnectWalletButton />}
          {ctas.has('release_protected') && accountId !== null && (
            <Button
              size="lg"
              block
              disabled={disabled || blocking('release_protected')}
              onClick={() => void onRun((config) => prepareReleaseProtected({ contractId, config, request, observedAtNs }))}
            >
              <Icon name="send" size={18} /> {c.releaseAction}
            </Button>
          )}
          {ctas.has('cancel_protected') && accountId !== null && (
            <>
              <Button
                variant="secondary"
                size="lg"
                block
                disabled={disabled || blocking('cancel_protected')}
                onClick={() =>
                  void onRun((config) => prepareCancelProtected({ contractId, config, request, signerAccountId: accountId, observedAtNs }))
                }
              >
                <Icon name="x" size={18} /> {c.cancelAction}
              </Button>
              <p className="px-1 text-xs text-[var(--text-muted)]">{c.cancelHint}</p>
            </>
          )}
        </div>
      )}

      {ctas.has('retry_same_operation') && op !== null && accountId !== null && (
        <Button
          size="lg"
          block
          disabled={disabled || blocking('retry_native_transfer')}
          onClick={() =>
            void onRun((config) => prepareRetryProtectedTransfer({ contractId, config, request, signerAccountId: accountId }), op.nonce)
          }
        >
          <Icon name="refresh" size={18} /> {op.kind === 'PROTECTED_REFUND' ? c.retryRefundAction : c.retryReleaseAction}
        </Button>
      )}

      {cancelLost && <InlineNotice copy={t.errors.CANCEL_WINDOW_CLOSED} />}
      {response.incident !== null && <InlineNotice copy={c.incident} live="assertive" />}
      {request.status.endsWith('_IN_FLIGHT') && response.incident === null && (
        <p className="px-1 text-sm text-[var(--tone-caution-fg)]">{c.inFlightNote}</p>
      )}
      {request.status === 'CANCELLED_REFUNDED' && <InlineNotice copy={c.refunded} tone="neutral" />}
      {request.status === 'FINAL_PAID' && <InlineNotice copy={c.released} tone="neutral" />}
    </>
  );
}

/**
 * Receipt for a settled native Protected request. Everything on it comes from
 * the escrow contract's final state; transaction links come from this device's
 * own journal. A refund is labelled as a refund, never as a payment, and a
 * release is "released", not "Verified Paid" (no independent Protected receipt
 * verifier exists yet).
 */
function ProtectedReceipt({
  request,
  entries,
  contractId,
}: {
  readonly request: Extract<PaymentView, { kind: 'ok' }>['request'];
  readonly entries: ReadonlyArray<JournalEntry>;
  readonly contractId: string;
}) {
  const t = useT();
  const c = t.protectedFlow;
  const r = t.experience.receipt;
  const shortDate = useShortDateTime();
  const share = useShareOrigin();
  const refunded = request.status === 'CANCELLED_REFUNDED';
  const op = request.latestOperation;
  const methodLabel: Partial<Record<JournalMethod, string>> = {
    create_request: c.newTitle,
    fund_protected_native: c.lockAction,
    cancel_protected: c.cancelAction,
    release_protected: c.releaseAction,
    retry_native_transfer: refunded ? c.retryRefundAction : c.retryReleaseAction,
  };
  const references: ReceiptReference[] = [
    ...entries.flatMap((e) =>
      e.transactionHash !== null && methodLabel[e.method] !== undefined
        ? [{ label: methodLabel[e.method] as string, value: e.transactionHash, transaction: true }]
        : [],
    ),
    { label: r.escrowContract, value: contractId },
  ];
  const link = share?.kind === 'ok' ? `${share.origin}/protected/${request.terms.id}` : null;
  return (
    <ReceiptTicket
      status={refunded ? 'refunded' : 'released'}
      mode="protected"
      amountBaseUnits={request.terms.amountBaseUnits}
      recipientAccountId={request.recipientAccountId}
      payerAccountId={request.payerAccountId}
      memo={request.terms.memo}
      settledAtNs={op?.resolvedAtNs ?? null}
      extraRows={request.fundedAtNs !== null ? [{ label: r.lockedAt, value: shortDate(request.fundedAtNs) }] : []}
      references={references}
      explorerBaseUrl={CHAIN_CONFIG.ok ? CHAIN_CONFIG.explorerBaseUrl : null}
      actions={link !== null ? <ShareActions link={link} /> : undefined}
    />
  );
}
