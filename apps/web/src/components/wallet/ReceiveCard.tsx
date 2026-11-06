'use client';

import { useSyncExternalStore } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { DemoStamp, Monogram, NetworkPill, TicketTear } from '@/components/experience/Basics';
import { QrCode } from '@/components/payments/QrCode';
import { Button, ButtonLink } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { useCopy } from '@/lib/hooks/browser';
import { useT } from '@/lib/i18n/provider';

const noSubscription = () => () => undefined;

/**
 * Receive: the account ID as a cream ticket, its QR code (identity only, never
 * an amount), copy and native share, and a clear NEAR Testnet-only warning.
 * Shared by /receive and the /demo tour (`demo` adds the DEMO marker).
 */
export function ReceiveCard({ accountId, demo = false }: { readonly accountId: string; readonly demo?: boolean }) {
  const t = useT();
  const r = t.walletUx.receive;
  const { status, copy } = useCopy();
  const canShare = useSyncExternalStore(noSubscription, () => typeof navigator.share === 'function', () => false);

  return (
    <div className="animate-rise flex flex-col gap-4">
      <section className="paper relative overflow-hidden px-5 pb-5 pt-5" aria-labelledby="receive-title">
        <div className="mb-5 flex items-center justify-between gap-3">
          <TaplyWordmark width={72} tone="paper" />
          <NetworkPill tone="paper" />
        </div>
        {demo && <DemoStamp />}
        <div className="flex items-center gap-3">
          <Monogram accountId={accountId} tone="paper" size={48} />
          <div className="min-w-0">
            <h2 id="receive-title" className="eyebrow text-[var(--ink-muted)]">
              {r.ticketTitle}
            </h2>
            <p className="chain-id mt-1.5 text-base font-semibold">{accountId}</p>
          </div>
        </div>
        <TicketTear />
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-[var(--paper-shade)] p-2">
            <QrCode value={accountId} label={r.ticketTitle} size={208} />
          </div>
          <p className="text-center text-sm text-[var(--ink-secondary)]">{r.qrNote}</p>
        </div>
      </section>

      <div className={`grid grid-cols-1 gap-2 ${canShare ? 'min-[380px]:grid-cols-2' : ''}`}>
        <Button size="lg" block onClick={() => copy(accountId)}>
          <Icon name={status === 'copied' ? 'check' : 'copy'} size={18} />
          {status === 'copied' ? r.copied : r.copy}
        </Button>
        {canShare && (
          <Button
            size="lg"
            block
            variant="secondary"
            onClick={() => {
              void navigator.share({ text: accountId }).catch(() => undefined);
            }}
          >
            <Icon name="share" size={18} />
            {r.share}
          </Button>
        )}
      </div>
      <span className="sr-only" role="status">
        {status === 'copied' ? r.copied : status === 'failed' ? t.wallet.copyFailed : ''}
      </span>

      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-4">
        <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-[var(--tone-caution-fg)]" />
        <div>
          <p className="text-sm font-semibold text-[var(--tone-caution-fg)]">{r.networkWarning.title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--text-secondary)]">{r.networkWarning.body}</p>
        </div>
      </div>

      {!demo && (
        <ButtonLink href="/request/new" variant="ghost" block>
          <Icon name="request" size={18} />
          {r.requestInstead}
        </ButtonLink>
      )}
    </div>
  );
}
