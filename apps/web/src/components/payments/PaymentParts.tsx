'use client';

import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Amount, AccountId } from '@/components/primitives/Amount';
import { Button, ButtonLink } from '@/components/primitives/Button';
import { Card, DetailRow } from '@/components/primitives/Surface';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { formatCutoff } from '@/lib/format/time';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { useCopy } from '@/lib/hooks/browser';
import { explorerTransactionUrl } from '@/lib/near/config';
import { usePayments } from '@/lib/payments/context';
import type { SigningBlock } from '@/lib/payments/context';
import type { SubmitResult } from '@/lib/payments/submit';
import { NEAR_NATIVE } from '@/lib/protocol';
import type { BlockRef, ContractRequest, IntentTerms } from '@/lib/protocol';
import { RequestTicket } from '@/components/experience/RequestTicket';
import { saleCode } from '@/lib/merchant/journey';
import type { RequestProvenance } from '@/lib/verify/provenance';

/**
 * Contract configuration problems that stop every payment screen. Null when reads may proceed.
 * `retryElsewhere`: the screen already has ONE "Check again" control that also
 * re-runs this check (Phase 7H: no second retry button for the same outage).
 */
export function PaymentsSetupNotice({ retryElsewhere = false }: { readonly retryElsewhere?: boolean } = {}) {
  const t = useT();
  const { setup, check, recheck } = usePayments();
  if (setup.status === 'not_configured') return <InlineNotice copy={t.payment.setup.notConfigured} tone="neutral" />;
  if (setup.status === 'invalid_config') return <InlineNotice copy={t.payment.setup.invalidConfig} tone="danger" />;
  if (setup.status === 'chain_unavailable') return <InlineNotice copy={t.payment.setup.chainUnavailable} tone="danger" />;
  if (check.status === 'rejected') return <InlineNotice copy={t.payment.setup.rejected} tone="danger" />;
  if (check.status === 'stale_chain') {
    return (
      <InlineNotice
        copy={check.freshness === 'future' ? t.reliability.clockAhead : t.reliability.staleChain}
        action={
          retryElsewhere ? undefined : (
            <Button variant="secondary" onClick={recheck}>
              {t.common.retry}
            </Button>
          )
        }
      />
    );
  }
  if (check.status === 'unreachable') {
    const copy =
      check.error === 'CONTRACT_CODE_MISMATCH'
        ? t.payment.setup.codeMismatch
        : check.error === 'RPC_RATE_LIMITED'
          ? t.payment.setup.rateLimited
          : t.payment.setup.unreachable;
    return (
      <InlineNotice
        copy={copy}
        tone={check.error === 'CONTRACT_CODE_MISMATCH' ? 'danger' : 'caution'}
        action={
          check.error === 'CONTRACT_CODE_MISMATCH' || retryElsewhere ? undefined : (
            <Button variant="secondary" onClick={recheck}>
              {t.common.retry}
            </Button>
          )
        }
      />
    );
  }
  return null;
}

/** Explains why a signing button is absent. Shown instead of a disabled control. */
export function SigningBlockNotice({ block }: { readonly block: SigningBlock }) {
  const t = useT();
  if (block === 'signing_flag_off') return <InlineNotice copy={t.payment.signing.flagOff} tone="neutral" />;
  if (block === 'contract_unverified') return <InlineNotice copy={t.payment.signing.unverified} tone="neutral" />;
  // Setup problems are already explained by PaymentsSetupNotice.
  return null;
}

export function SubmitResultNotice({ result, onReattempt }: { readonly result: SubmitResult; readonly onReattempt?: () => void }) {
  const t = useT();
  const { setup } = usePayments();
  const explorer = setup.status === 'ready' ? setup.explorerBaseUrl : null;
  switch (result.kind) {
    case 'submitted':
      return (
        <InlineNotice
          copy={t.payment.signing.submitted}
          tone="neutral"
          action={explorer !== null ? <TransactionLink explorerBaseUrl={explorer} hash={result.transactionHash} /> : undefined}
        />
      );
    case 'unknown':
      return <InlineNotice copy={t.payment.signing.unknown} live="assertive" />;
    case 'rejected':
      return <InlineNotice copy={t.payment.signing.rejected} tone="neutral" />;
    case 'wrong_account':
      return <InlineNotice copy={t.payment.signing.wrongAccount} tone="danger" />;
    case 'not_sent':
      return <InlineNotice copy={t.payment.signing.notSent} />;
    case 'no_journal':
      return <InlineNotice copy={t.payment.signing.noJournal} tone="danger" />;
    case 'blocked':
      return (
        <InlineNotice
          copy={t.payment.signing.blocked}
          action={
            onReattempt === undefined ? undefined : (
              <Button variant="secondary" onClick={onReattempt}>
                {t.payment.signing.reattempt}
              </Button>
            )
          }
        />
      );
  }
}

export function TransactionLink({ explorerBaseUrl, hash }: { readonly explorerBaseUrl: string; readonly hash: string }) {
  const t = useT();
  return (
    <a
      href={explorerTransactionUrl(explorerBaseUrl, hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[44px] min-w-0 flex-wrap items-center gap-1 text-sm underline underline-offset-2"
    >
      {t.payment.signing.viewTransaction}
      <span className="chain-id break-all">{hash}</span>
      <Icon name="external" size={14} />
    </a>
  );
}

export function ChainTime({ ns }: { readonly ns: string }) {
  const { locale } = useLocale();
  const { utc, local } = formatCutoff(ns, locale);
  return (
    <span className="flex flex-col items-end">
      <span>{local}</span>
      <span className="text-xs text-[var(--text-muted)]">{utc}</span>
    </span>
  );
}

/**
 * The immutable terms of a request, as the contract stores them. Account IDs
 * are always shown in full and the amount always exactly (UX_FLOWS screen 08).
 */
export function RequestTerms({ request, children }: { readonly request: ContractRequest; readonly children?: ReactNode }) {
  // The shared schema guarantees recipientAccountId === terms.creatorAccountId.
  // The funding deadline only matters while the request can still be funded.
  return (
    <RequestTermsPreview terms={request.terms} showExpiry={request.status === 'OPEN'}>
      {children}
    </RequestTermsPreview>
  );
}

/** Same rows for terms that are not on chain yet (creation review). */
export function RequestTermsPreview({
  terms,
  showExpiry = true,
  children,
}: {
  readonly terms: IntentTerms;
  readonly showExpiry?: boolean;
  readonly children?: ReactNode;
}) {
  const t = useT();
  return (
    <Card>
      <dl>
        <DetailRow label={t.payment.review.recipient} emphasis>
          <AccountId accountId={terms.creatorAccountId} />
        </DetailRow>
        <DetailRow label={t.payment.review.amount} emphasis>
          <Amount baseUnits={terms.amountBaseUnits} asset={NEAR_NATIVE} className="text-lg" />
        </DetailRow>
        <DetailRow label={t.payment.review.exactBaseUnits}>
          <span className="chain-id">{terms.amountBaseUnits}</span>
        </DetailRow>
        <DetailRow label={t.payment.review.memo}>
          {terms.memo === '' ? (
            <span className="text-[var(--text-muted)]">{t.payment.review.noMemo}</span>
          ) : (
            // Plain text only: memos are untrusted and never rendered as HTML.
            <span className="whitespace-pre-wrap break-words">{terms.memo}</span>
          )}
        </DetailRow>
        <DetailRow label={t.payment.review.permittedPayer}>
          {terms.permittedPayerAccountId === null ? t.payment.review.anyPayer : <AccountId accountId={terms.permittedPayerAccountId} />}
        </DetailRow>
        <DetailRow label={t.common.mode}>{t.mode.instant}</DetailRow>
        <DetailRow label={t.common.network}>{t.app.networkBadge}</DetailRow>
        {showExpiry && (
          <DetailRow label={t.payment.review.expires}>
            <ChainTime ns={terms.fundingExpiresAtNs} />
          </DetailRow>
        )}
        <DetailRow label={t.payment.review.contract}>
          <AccountId accountId={terms.contractId} />
        </DetailRow>
        <DetailRow label={t.routes.requestIdLabel}>
          <span className="chain-id break-all">{terms.id}</span>
        </DetailRow>
        {children}
      </dl>
    </Card>
  );
}

/** Where the data came from: the finalized block and when it was read. */
export function Provenance({ block, checkedAt }: { readonly block: BlockRef | null; readonly checkedAt: string | null }) {
  const t = useT();
  const { locale } = useLocale();
  if (block === null || checkedAt === null) return null;
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(new Date(checkedAt));
  return (
    <p className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 px-1 text-xs text-[var(--text-muted)]">
      <span>{fill(t.payment.status.observedBlock, { height: block.height })}</span>
      <span>{fill(t.payment.status.checkedAt, { time })}</span>
      <span>{t.payment.setup.verifiedContract}</span>
    </p>
  );
}

/** Share link + copy + native share + QR of exactly the same link (UX_FLOWS screen 07). */
export function ShareRequest({ link, request }: { readonly link: string; readonly request: ContractRequest }) {
  return (
    <RequestTicket
      link={link}
      recipientAccountId={request.recipientAccountId}
      amountBaseUnits={request.terms.amountBaseUnits}
      memo={request.terms.memo}
      expiresAtNs={request.status === 'OPEN' ? request.terms.fundingExpiresAtNs : null}
      permittedPayerAccountId={request.terms.permittedPayerAccountId}
      code={saleCode(request.terms.id)}
      actions={<ShareActions link={link} />}
    />
  );
}

/**
 * Phase 6A: this page runs on an address other phones cannot open (localhost,
 * a private IP, plain HTTP) and no public share origin is configured. No QR is
 * shown; the bare request ID still works with "Pay with link".
 */
export function ShareUnavailable({
  reason,
  requestId,
}: {
  readonly reason: 'local_only' | 'invalid_config';
  readonly requestId: string;
}) {
  const t = useT();
  const so = t.oneTap.shareOrigin;
  const { status, copy } = useCopy();
  return (
    <section className="flex flex-col gap-3" data-testid="share-unavailable">
      <InlineNotice copy={reason === 'invalid_config' ? so.invalidConfig : so.localOnly} tone="neutral" />
      <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
        <p className="eyebrow text-[var(--text-muted)]">{so.requestIdLabel}</p>
        <p className="chain-id mt-2 break-all text-sm">{requestId}</p>
        <Button className="mt-3" block variant="secondary" onClick={() => copy(requestId)}>
          <Icon name={status === 'copied' ? 'check' : 'copy'} size={18} />
          {status === 'copied' ? so.idCopied : so.copyId}
        </Button>
        <span className="sr-only" role="status">
          {status === 'copied' ? so.idCopied : ''}
        </span>
      </div>
    </section>
  );
}

const noSubscription = () => () => undefined;

/** Copy + native share for a payment link. Used by the real share screen and the demo tour. */
export function ShareActions({ link }: { readonly link: string }) {
  const t = useT();
  const { status, copy } = useCopy();
  // Read after hydration: the server cannot know, and a mismatch would break hydration.
  const canShare = useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === 'function',
    () => false,
  );
  return (
    <div className="flex flex-col gap-1">
      {/* One dominant action: native share where available, otherwise copy. */}
      {canShare && (
        <Button
          block
          size="lg"
          variant="primary"
          onClick={() => {
            void navigator.share({ url: link }).catch(() => undefined);
          }}
        >
          <Icon name="share" size={18} />
          {t.payment.share.share}
        </Button>
      )}
      <Button block size={canShare ? 'md' : 'lg'} variant={canShare ? 'ghost' : 'primary'} onClick={() => copy(link)}>
        <Icon name={status === 'copied' ? 'check' : 'copy'} size={18} />
        {status === 'copied' ? t.payment.share.linkCopied : t.payment.share.copyLink}
      </Button>
      <span className="sr-only" role="status">
        {status === 'copied' ? t.payment.share.linkCopied : ''}
      </span>
    </div>
  );
}

export function BackToPayment({ id }: { readonly id: string }) {
  const t = useT();
  return (
    <ButtonLink href={`/pay/${id}`} variant="ghost" block>
      {t.payment.receipt.backToPayment}
    </ButtonLink>
  );
}

/** Compact "Verified request" chip with the checks behind it (lib/verify/provenance.ts). */
export function VerifiedRequestChip({ provenance }: { readonly provenance: RequestProvenance }) {
  const t = useT();
  const c = t.verifiedRequest;
  return (
    <details className="disclosure rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3 py-1" data-testid="verified-request">
      <summary className="flex min-h-[var(--tap-target)] items-center gap-2 text-sm">
        <Icon name={provenance.verified ? 'shield' : 'alert'} size={16} className={provenance.verified ? 'text-[var(--taply-lime)]' : 'text-[var(--tone-caution-fg)]'} />
        <span className="font-medium">{provenance.verified ? c.verified : c.unverified}</span>
        <Icon name="chevron" size={14} className="disclosure-chevron ml-auto text-[var(--text-muted)]" />
      </summary>
      <ul className="flex flex-col gap-1 pb-2 text-xs text-[var(--text-secondary)]">
        {provenance.passed.map((k) => (
          <li key={k}>✓ {c.checks[k]}</li>
        ))}
        {provenance.failed.map((k) => (
          <li key={k} className="text-[var(--tone-caution-fg)]">✗ {c.checks[k]}</li>
        ))}
        <li className="text-[var(--text-muted)]">{c.notIdentity}</li>
      </ul>
    </details>
  );
}
