'use client';

import { useSyncExternalStore } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { QrCode } from '@/components/payments/QrCode';
import { Button, ButtonLink } from '@/components/primitives/Button';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { useCopy } from '@/lib/hooks/browser';
import { useT } from '@/lib/i18n/provider';
import { canonicalCheckoutUrl, merchantCheckoutPath } from '@/lib/merchant/discovery';
import { useShareOrigin } from '@/lib/share/use-share-origin';

const noSubscription = () => () => undefined;

/**
 * The merchant's permanent discovery QR (`/checkout/<accountId>`).
 *
 * It is labelled DISCOVERY ONLY on the printed card itself, not just beside
 * it, so a photo or printout can never be mistaken for a payable invoice.
 * The QR is only drawn when a public HTTPS share origin exists; a localhost
 * or private address would produce a code that fails on the customer's phone.
 */
export function DiscoveryQr({ accountId }: { readonly accountId: string }) {
  const t = useT();
  const d = t.commerce.discovery;
  const origin = useShareOrigin();
  const { status, copy } = useCopy();
  const canShare = useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === 'function',
    () => false,
  );

  const url = origin !== null && origin.kind === 'ok' ? canonicalCheckoutUrl(origin.origin, accountId) : null;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--text-secondary)]">{d.onlyDiscovery.body}</p>

      {origin === null ? null : url === null ? (
        <InlineNotice copy={d.unavailable} tone="neutral" />
      ) : (
        <>
          <figure
            data-testid="discovery-card"
            className="animate-page mx-auto flex w-full max-w-[340px] flex-col items-center gap-4 rounded-[var(--radius-hero)] bg-[var(--paper)] px-6 pb-6 pt-5 text-[var(--ink)] shadow-[var(--shadow-paper)]"
          >
            <div className="flex w-full items-center justify-between">
              <TaplyWordmark width={64} tone="paper" />
              <span className="rounded-full bg-[var(--ink)] px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-[var(--paper)]">
                {d.qrLabel}
              </span>
            </div>
            <QrCode value={url} label={d.qrLabel} size={232} />
            <figcaption className="flex w-full flex-col items-center gap-1 text-center">
              <span className="text-xs text-[var(--ink-muted)]">{d.accountLine}</span>
              <span className="chain-id break-all text-sm font-semibold">{accountId}</span>
              <span className="mt-2 rounded-full border border-[var(--ink-line)] px-3 py-1 text-[11px] font-semibold text-[var(--ink-secondary)]">
                {d.onlyDiscovery.title}
              </span>
            </figcaption>
          </figure>

          <div className="flex flex-col gap-1">
            <p className="eyebrow px-1 text-[var(--text-muted)]">{d.linkLabel}</p>
            <p className="chain-id break-all px-1 text-sm text-[var(--text-secondary)]">{url}</p>
          </div>

          <div className="flex flex-col gap-1">
            {canShare && (
              <Button
                block
                size="lg"
                onClick={() => {
                  void navigator.share({ url }).catch(() => undefined);
                }}
              >
                <Icon name="share" size={18} />
                {d.share}
              </Button>
            )}
            <Button block size={canShare ? 'md' : 'lg'} variant={canShare ? 'ghost' : 'primary'} onClick={() => copy(url)}>
              <Icon name={status === 'copied' ? 'check' : 'copy'} size={18} />
              {status === 'copied' ? d.copied : d.copy}
            </Button>
            <span className="sr-only" role="status">
              {status === 'copied' ? d.copied : ''}
            </span>
          </div>
        </>
      )}

      <ButtonLink href={merchantCheckoutPath(accountId)} variant="secondary" block>
        <Icon name="external" size={16} />
        {d.preview}
      </ButtonLink>

      <details className="disclosure">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm">{t.oneTap.payment.details}</summary>
        <InlineNotice copy={d.profilePending} tone="neutral" />
      </details>
    </div>
  );
}
