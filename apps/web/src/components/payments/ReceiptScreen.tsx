'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReadResult, TerminalFactsRead } from '@taply/near-client';
import { AccountId } from '@/components/primitives/Amount';
import { Button, Spinner } from '@/components/primitives/Button';
import { DetailRow } from '@/components/primitives/Surface';
import { ReceiptTicket } from '@/components/experience/ReceiptTicket';
import type { ReceiptReference } from '@/components/experience/ReceiptTicket';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { useCopy } from '@/lib/hooks/browser';
import { useT } from '@/lib/i18n/provider';
import { usePayments } from '@/lib/payments/context';
import { callerRoleFor } from '@/lib/payments/intent';
import { mapChainState } from '@/lib/payments/map-chain-state';
import { HashHexSchema } from '@/lib/protocol';
import type { ContractRequest, VerifiedReceipt } from '@/lib/protocol';
import type { JournalEntry } from '@/lib/payments/journal';
import { collectReferences, parseLinkHints, verificationLink } from '@/lib/verify/references';
import type { LinkHints } from '@/lib/verify/references';
import { useShareOrigin } from '@/lib/share/use-share-origin';
import { saleCode } from '@/lib/merchant/journey';
import { useFundingLocator } from '@/lib/verify/use-funding-locator';
import type { LocatorView } from '@/lib/verify/use-funding-locator';
import { useReceiptVerification } from '@/lib/verify/use-receipt-verification';
import type { VerificationView } from '@/lib/verify/use-receipt-verification';
import { useAccountId } from '@/lib/wallet/provider';
import {
  BackToPayment,
  ChainTime,
  PaymentsSetupNotice,
  Provenance,
  RequestTerms,
} from './PaymentParts';

/**
 * `/receipt/[id]` (UX_FLOWS screen 17).
 *
 * Two layers, never merged:
 *  1. The contract's own terminal facts (`get_receipt`) at a finalized block of
 *     the approved code. Labelled CONTRACT_FACTS_NOT_FINALITY_PROOF.
 *  2. Phase 2D: the independent receipt verifier (lib/verify). Only its
 *     `verified` result can turn on the Verified Paid ribbon, and only through
 *     `mapChainState(..., settlementProof: 'verified_receipt')`.
 *
 * The verifier needs transaction hashes. They come from this device's journal
 * or from a verification link (`?ftx=&rtx=`); either way the chain decides.
 */
export function ReceiptScreen({ id }: { readonly id: string }) {
  const t = useT();
  const { setup, journal, walletReturnsPending } = usePayments();
  const accountId = useAccountId();
  const [readState, setRead] = useState<{ id: string; result: ReadResult<TerminalFactsRead> } | null>(null);
  // A previous route's terminal facts must disappear in the very first render
  // of a new ID, before the asynchronous read/effect runs.
  const read = readState?.id === id ? readState.result : null;
  // The server renders without the query string; the client reads it after hydration.
  const search = useSyncExternalStore(
    noSubscription,
    () => window.location.search,
    () => '',
  );
  const hints = useMemo<LinkHints>(() => parseLinkHints(search), [search]);
  const [generation, setGeneration] = useState(0);
  const validId = HashHexSchema.safeParse(id).success;

  useEffect(() => {
    if (!validId || setup.status !== 'ready') return;
    let active = true;
    void setup.reader.readTerminalFacts(id).then((result) => {
      if (active) setRead({ id, result });
    });
    return () => {
      active = false;
    };
  }, [id, validId, setup]);

  const facts = read !== null && read.error === null ? (read.observation.data?.facts ?? null) : null;
  const ready = setup.status === 'ready' ? setup : null;
  const request =
    facts !== null && ready !== null && facts.request.terms.id === id && facts.request.terms.contractId === ready.contractId ? facts.request : null;
  const entries = journal?.isReadable() ? journal.forRequest(id) : [];
  const known = request === null ? null : collectReferences(request, entries, hints);
  // Phase 7G: no funding hash on this device or in the link (typically the merchant's
  // phone). Look the payment up from public chain data. The located hash is only a
  // candidate, exactly like a link hint: the verifier below still decides.
  const missing = request === null ? 'elsewhere' : missingEvidence(request, entries, walletReturnsPending);
  const located = useFundingLocator({
    rpc: ready?.locatorRpc ?? null,
    contractId: ready?.contractId ?? '',
    request,
    enabled: known !== null && known.funding === null && missing !== 'matching',
    generation,
  });
  const candidate = located.kind === 'found' ? (located.candidates[0] ?? null) : null;
  const references =
    request === null || known === null ? null : candidate === null ? known : collectReferences(request, entries, { ...hints, funding: candidate });
  const verification = useReceiptVerification({
    rpc: ready?.verifierRpc ?? null,
    contractId: ready?.contractId ?? '',
    approvedCodeHash: ready?.expectedCodeHash ?? '',
    request,
    references,
    generation,
  });

  if (!validId) return <InlineNotice copy={t.payment.status.invalidId} tone="danger" />;
  if (setup.status !== 'ready') return <PaymentsSetupNotice />;
  if (read === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" role="status">
        <Spinner /> {t.common.loading}
      </p>
    );
  }

  const { observation, error } = read;
  if (error !== null || observation.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice
          copy={error?.code === 'CONTRACT_CODE_MISMATCH' ? t.payment.setup.codeMismatch : t.payment.status.readFailed}
        />
        <BackToPayment id={id} />
      </div>
    );
  }
  if (facts === null || request === null) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotice copy={t.payment.receipt.notTerminal} tone="neutral" />
        <BackToPayment id={id} />
      </div>
    );
  }

  const paid = request.status === 'FINAL_PAID';
  const verified =
    verification.kind === 'verified' && matches(verification.receipt, request) ? verification.receipt : null;
  const presentation = mapChainState({
    state: request.status,
    observation,
    derived: {
      callerRole: callerRoleFor(request, accountId),
      cancelWindowOpen: null,
      releaseEligible: null,
      retry: { eligible: false, operationNonce: null, kind: null },
    },
    fundingEligibility: 'NOT_OPEN',
    incident: null,
    settlementProof: verified !== null ? 'verified_receipt' : 'contract_state_only',
  });
  const hashes = entries.flatMap((e) =>
    e.transactionHash === null ? [] : [{ method: e.method, hash: e.transactionHash }],
  );

  const showVerified = presentation.verifiedRibbon && verified !== null;
  const status = showVerified ? 'verified' : paid ? 'contract_paid' : 'cancelled';
  const v = t.payment.verification;
  const ticketReferences: ReceiptReference[] =
    showVerified && verified !== null
      ? [
          { label: v.fundingTx, value: verified.fundingTransaction.hash, transaction: true },
          ...(verified.settlementTransaction.hash !== verified.fundingTransaction.hash
            ? [{ label: v.settlementTx, value: verified.settlementTransaction.hash, transaction: true }]
            : []),
          { label: v.transferReceipt, value: verified.transferReceipt.receiptId },
          { label: v.callbackReceipt, value: verified.callbackReceipt.receiptId },
          { label: v.stateBlock, value: `#${verified.contractStateBlock.height}` },
        ]
      : hashes.map(({ method, hash }) => ({
          label:
            method === 'pay_instant_native'
              ? v.fundingTx
              : method === 'retry_native_transfer'
                ? v.settlementTx
                : t.payment.signing.viewTransaction,
          value: hash,
          transaction: true,
        }));

  return (
    <div className="flex flex-col gap-4">
      <div data-testid={showVerified ? 'verified-evidence' : undefined}>
        <ReceiptTicket
          status={status}
          amountBaseUnits={request.terms.amountBaseUnits}
          recipientAccountId={request.recipientAccountId}
          payerAccountId={request.payerAccountId}
          memo={request.terms.memo}
          settledAtNs={showVerified && verified !== null ? verified.callbackReceipt.block.timestampNs : facts.terminalAtNs}
          references={ticketReferences}
          explorerBaseUrl={setup.explorerBaseUrl}
          code={saleCode(request.terms.id)}
          {...(showVerified && verified !== null
            ? {
                checkedVia: verified.verification.rpcProviderId,
                celebrateKey: `${id}:${verified.callbackReceipt.receiptId}`,
                proofActions: <ProofActions receipt={verified} />,
              }
            : {})}
          actions={showVerified && verified !== null ? <ShareVerification id={id} receipt={verified} /> : undefined}
        />
      </div>
      {!showVerified && paid && (
        <VerificationNotice
          view={verification}
          located={located}
          missing={missing}
          onRetry={() => setGeneration((g) => g + 1)}
        />
      )}
      {!showVerified && paid && (
        <p className="px-1 text-xs text-[var(--text-muted)]">{t.payment.settlementProofPending}</p>
      )}
      {showVerified && candidate !== null && (
        <p className="px-1 text-center text-xs text-[var(--text-muted)]" data-testid="located-note">
          {t.commerce.phase7g.locate.foundNote}
        </p>
      )}

      <details className="disclosure">
        <summary className="flex min-h-[var(--tap-target)] items-center justify-between gap-3 px-1 text-sm font-medium text-[var(--text-secondary)]">
          {t.payment.receipt.factsTitle}
          <Icon name="chevron" size={16} className="disclosure-chevron shrink-0" />
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-sm text-[var(--text-secondary)]">{t.payment.receipt.factsNote}</p>
          <p className="text-sm">
            {paid ? t.payment.receipt.payoutConfirmedByContract : t.payment.receipt.cancelledNothingPaid}
          </p>
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
            {request.latestOperation !== null && (
              <DetailRow label={t.payment.status.operationLabel}>
                <span className="chain-id">
                  #{request.latestOperation.nonce} · {t.payment.status.operationStatus[request.latestOperation.status]}
                </span>
              </DetailRow>
            )}
            <DetailRow label={t.payment.receipt.terminalBlock}>
              <span className="chain-id">#{facts.terminalBlockHeight}</span>
            </DetailRow>
            <DetailRow label={t.payment.receipt.terminalAt}>
              <ChainTime ns={facts.terminalAtNs} />
            </DetailRow>
          </RequestTerms>
          <Provenance block={observation.observedBlock} checkedAt={observation.checkedAt} />
        </div>
      </details>
      <BackToPayment id={id} />
    </div>
  );
}

const noSubscription = () => () => undefined;

/** A receipt from another read must describe exactly the request shown. */
function matches(receipt: VerifiedReceipt, request: ContractRequest): boolean {
  return (
    receipt.requestId === request.terms.id &&
    receipt.termsHash === request.termsHash &&
    receipt.payerAccountId === request.payerAccountId &&
    receipt.recipientAccountId === request.recipientAccountId &&
    receipt.amountBaseUnits === request.terms.amountBaseUnits &&
    receipt.operationNonce === request.latestOperation?.nonce
  );
}

/**
 * Why the funding hash is missing (Phase 6A), so the screen can be specific:
 *  - `matching`: a wallet-returned hash is still being matched on chain;
 *  - `wallet_no_reference`: this device paid, but its wallet never returned a hash;
 *  - `elsewhere`: this device did not pay (another device or wallet did).
 */
type MissingEvidence = 'matching' | 'wallet_no_reference' | 'elsewhere';

function missingEvidence(
  request: ContractRequest,
  entries: ReadonlyArray<JournalEntry>,
  walletReturnsPending: number,
): MissingEvidence {
  const own = entries.some(
    (e) =>
      e.method === 'pay_instant_native' &&
      e.signerAccountId === request.payerAccountId &&
      e.transactionHash === null &&
      e.phase !== 'USER_REJECTED',
  );
  if (!own) return 'elsewhere';
  return walletReturnsPending > 0 ? 'matching' : 'wallet_no_reference';
}

function VerificationNotice({
  view,
  located,
  missing,
  onRetry,
}: {
  readonly view: VerificationView;
  readonly located: LocatorView;
  readonly missing: MissingEvidence;
  readonly onRetry: () => void;
}) {
  const t = useT();
  const v = t.payment.verification;
  switch (view.kind) {
    case 'not_applicable':
    case 'verified':
      return null;
    case 'checking':
      if (located.kind === 'found') return <LocatorProgress step="check" />;
      return (
        <p className="flex items-center gap-2 px-1 text-sm text-[var(--text-secondary)]" role="status">
          <Spinner /> {v.checking}
        </p>
      );
    case 'unavailable':
      return <InlineNotice copy={v.unavailable} tone="neutral" />;
    case 'missing_reference':
      if (missing !== 'matching' && located.kind === 'searching') return <LocatorProgress step="find" />;
      if (missing !== 'matching' && located.kind !== 'idle' && located.kind !== 'found') return <LocatorOutcome view={located} onRetry={onRetry} />;
      if (missing === 'matching') {
        return (
          <p className="flex items-center gap-2 px-1 text-sm text-[var(--text-secondary)]" role="status">
            <Spinner /> {t.oneTap.receiptEvidence.matching}
          </p>
        );
      }
      return (
        <InlineNotice
          copy={missing === 'wallet_no_reference' ? t.oneTap.receiptEvidence.walletNoReference : v.missingReference}
          tone="neutral"
        />
      );
    case 'failed': {
      const copy = view.transient
        ? v.failedTransient
        : view.reason === 'HISTORY_UNAVAILABLE'
          ? v.historyUnavailable
          : v.failedMismatch;
      const tone = view.transient || view.reason === 'HISTORY_UNAVAILABLE' ? 'neutral' : 'danger';
      return (
        <div className="flex flex-col gap-2" data-testid="verification-failed">
          <InlineNotice copy={copy} tone={tone} />
          <p className="px-1 text-xs text-[var(--text-muted)]">
            {v.reasonCode}: <span className="chain-id">{view.reason}</span>
          </p>
          <Button variant="secondary" onClick={onRetry}>
            {v.checkAgain}
          </Button>
        </div>
      );
    }
  }
}

function ShareVerification({ id, receipt }: { readonly id: string; readonly receipt: VerifiedReceipt }) {
  const t = useT();
  const { status, copy } = useCopy();
  const share = useShareOrigin();
  // Only a public HTTPS origin makes a link another device can open (Phase 6A).
  if (share?.kind !== 'ok') return null;
  const retries = receipt.operationNonce === '1' ? [] : [receipt.settlementTransaction];
  // More than one retry: this device cannot list every hash, so it offers no link.
  if (BigInt(receipt.operationNonce) > 2n) return null;
  const link = verificationLink(share.origin, id, {
    funding: receipt.fundingTransaction,
    retries,
  });
  return (
    <div className="flex flex-col gap-1.5">
      <Button size="lg" block onClick={() => copy(link)}>
        <Icon name={status === 'copied' ? 'check' : 'link'} size={18} />
        {status === 'copied' ? t.payment.verification.linkCopied : t.payment.verification.copyLink}
      </Button>
      <p className="px-1 text-center text-xs text-[var(--text-muted)]">{t.payment.verification.linkNote}</p>
      <span className="sr-only" role="status">
        {status === 'copied' ? t.payment.verification.linkCopied : ''}
      </span>
    </div>
  );
}

/** Inside the collapsed technical proof: what was checked, and the raw evidence. */
function ProofActions({ receipt }: { readonly receipt: VerifiedReceipt }) {
  const t = useT();
  // Public chain data only (the shared VerifiedReceipt): for pilot evidence and support.
  const evidence = useCopy();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs leading-relaxed text-[var(--ink-secondary)]">{t.payment.verification.verifiedNote}</p>
      <button
        type="button"
        onClick={() => evidence.copy(JSON.stringify(receipt, null, 2))}
        className="tap-target inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ink-line)] px-3 text-sm font-medium text-[var(--ink)] hover:bg-[rgb(11_18_14/0.04)]"
      >
        <Icon name={evidence.status === 'copied' ? 'check' : 'copy'} size={16} />
        {evidence.status === 'copied' ? t.payment.verification.evidenceCopied : t.payment.verification.copyEvidence}
      </button>
    </div>
  );
}

/**
 * Phase 7G: two real steps, each a bounded read that is actually running. The
 * current step pulses; nothing advances on a timer.
 */
function LocatorProgress({ step }: { readonly step: 'find' | 'check' }) {
  const t = useT();
  const l = t.commerce.phase7g.locate;
  const items = [
    { key: 'find', label: l.stepFind, state: step === 'find' ? 'current' : 'done' },
    { key: 'check', label: l.stepCheck, state: step === 'check' ? 'current' : 'todo' },
  ] as const;
  return (
    <section className="surface-card flex flex-col gap-3 p-4" data-testid="locator-progress" data-step={step}>
      <div role="status" aria-live="polite">
        <p className="text-sm font-semibold">{step === 'find' ? l.searching.title : l.checking}</p>
        {step === 'find' && <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{l.searching.body}</p>}
      </div>
      <ol className="flex flex-col gap-2 text-sm">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2.5" data-state={item.state}>
            {item.state === 'done' ? (
              <span aria-hidden="true" className="grid size-[18px] place-items-center rounded-full bg-[var(--text-primary)] text-[var(--surface-0)]">
                <Icon name="check" size={12} />
              </span>
            ) : item.state === 'current' ? (
              <span aria-hidden="true" className="journey-node-current relative grid size-[18px] place-items-center rounded-full ring-2 ring-[var(--taply-gold)]">
                <span className="size-2 rounded-full bg-[var(--taply-gold)]" />
              </span>
            ) : (
              <span aria-hidden="true" className="size-[18px] rounded-full ring-2 ring-[var(--border-strong)]" />
            )}
            <span className={item.state === 'todo' ? 'text-[var(--text-muted)]' : ''}>{item.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The chain search ended without a candidate: still Paid per contract, said plainly. */
function LocatorOutcome({ view, onRetry }: { readonly view: LocatorView; readonly onRetry: () => void }) {
  const t = useT();
  const l = t.commerce.phase7g.locate;
  const copy =
    view.kind === 'history_unavailable'
      ? l.history
      : view.kind === 'not_applicable'
        ? view.reason === 'needs_retry_references'
          ? l.retryNeeded
          : t.payment.verification.missingReference
        : view.kind === 'unavailable' || view.kind === 'budget_exhausted'
          ? l.unavailable
          : l.notFound;
  const retryable = view.kind === 'unavailable' || view.kind === 'budget_exhausted' || view.kind === 'not_found';
  return (
    <div className="flex flex-col gap-2" data-testid="locator-outcome" data-kind={view.kind}>
      <InlineNotice copy={copy} tone="neutral" />
      {retryable && (
        <Button variant="secondary" onClick={onRetry}>
          {l.searchAgain}
        </Button>
      )}
    </div>
  );
}
