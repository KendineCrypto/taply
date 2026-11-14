'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { AmountHero, Monogram } from '@/components/experience/Basics';
import { Button, ButtonLink } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { fill } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { formatBaseUnits } from '@/lib/format/amount';
import { nsToDate } from '@/lib/format/time';

/**
 * Presentational wallet-home pieces shared by the Testnet and NEAR Mainnet builds
 * (same markup the Testnet home has always rendered). No wallet provider, network
 * client or signer is imported here: each build passes its own data and slots.
 */

/** First launch: connect an external wallet or create a Taply Wallet. */
export function FirstLaunchChooserView({ externalSlot, taplyAvailable, createHref, restoreHref, footnote }: {
  readonly externalSlot: ReactNode;
  readonly taplyAvailable: boolean;
  readonly createHref: string;
  readonly restoreHref: string;
  readonly footnote?: string;
}) {
  const t = useT();
  const c = t.walletNative.chooser;
  return (
    <section className="flex flex-col gap-4 pt-1" aria-labelledby="first-launch-title">
      <div>
        <h2 id="first-launch-title" className="text-[1.5rem] font-semibold leading-tight tracking-tight">
          {c.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{c.body}</p>
      </div>

      <div className="surface-card p-5" role="group" aria-labelledby="first-launch-external">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--taply-lime)] ring-1 ring-[var(--border-subtle)]">
            <Icon name="wallet" size={24} />
          </span>
          <div className="min-w-0">
            <h3 id="first-launch-external" className="text-lg font-semibold tracking-tight">
              {c.external.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{c.external.body}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">{externalSlot}</div>
      </div>

      <div className="surface-card p-5" role="group" aria-labelledby="first-launch-taply">
        <div className="flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--taply-lime)] text-[var(--taply-night)]">
            <Icon name="shield" size={24} />
          </span>
          <div className="min-w-0">
            <h3 id="first-launch-taply" className="text-lg font-semibold tracking-tight">
              {c.taply.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{c.taply.body}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {taplyAvailable ? (
            <ButtonLink href={createHref as Route} size="lg" block>
              {c.taplyCta}
              <Icon name="arrow-right" size={18} />
            </ButtonLink>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">{t.walletNative.unavailable.body}</p>
          )}
          {footnote !== undefined && <p className="text-xs leading-relaxed text-[var(--text-muted)]">{footnote}</p>}
        </div>
      </div>

      {taplyAvailable && (
        <Link
          href={restoreHref as Route}
          className="tap-target inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {c.restore}
          <Icon name="chevron" size={16} />
        </Link>
      )}
    </section>
  );
}

/** The status pill under the identity (provisioned / local-only / unknown / locked). */
export function WalletStatusPill({ tone, icon, label }: { readonly tone: 'success' | 'caution' | 'neutral'; readonly icon: IconName; readonly label: string }) {
  const cls = tone === 'success'
    ? 'bg-[var(--tone-success-bg)] text-[var(--taply-lime)]'
    : tone === 'caution'
      ? 'bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)] ring-1 ring-[var(--tone-caution-border)]'
      : 'bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      <Icon name={icon} size={13} />
      {label}
    </span>
  );
}

export interface IdentityBalance {
  readonly baseUnits: string;
  readonly blockTimestampNs: string;
  readonly blockHeight: string;
}

/** The Taply Wallet identity card with the prominent balance (Testnet home hero markup). */
export function IdentityCardView({ accountId, badges, balance, emptyBalance, statusBody, onRefresh, onRetry, actions, extra }: {
  readonly accountId: string;
  readonly badges: ReactNode;
  readonly balance: IdentityBalance | null;
  readonly emptyBalance: string;
  readonly statusBody: string;
  readonly onRefresh?: () => void;
  readonly onRetry?: () => void;
  readonly actions?: ReactNode;
  /** Network-specific content under the balance (e.g. NEAR Mainnet activation QR). */
  readonly extra?: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const n = t.walletNative;
  return (
    <section className="surface-hero p-5" aria-labelledby="taply-identity-title">
      <div className="flex items-start gap-3">
        <Monogram accountId={accountId} size={44} />
        <div className="min-w-0 flex-1">
          <h2 id="taply-identity-title" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--taply-lime)]">
            <Icon name="shield" size={15} />
            {n.taply}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{badges}</div>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs text-[var(--text-muted)]">{n.identityLabel}</p>
        <p className="chain-id mt-1 break-all text-sm text-[var(--text-primary)]">{accountId}</p>
      </div>

      <div className="mt-5 border-t border-[var(--border-subtle)] pt-4" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-[var(--text-secondary)]">{t.walletUx.home.totalBalance}</p>
          {balance !== null && onRefresh !== undefined && (
            <Button variant="ghost" className="px-2" onClick={onRefresh} aria-label={t.balance.refresh}>
              <Icon name="refresh" size={16} />
            </Button>
          )}
        </div>
        {balance !== null ? (
          <>
            <AmountHero baseUnits={balance.baseUnits} className="mt-2" />
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Icon name="check" size={14} className="text-[var(--taply-lime)]" />
              {fill(t.balance.verifiedAt, {
                time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(nsToDate(balance.blockTimestampNs)),
              })}
              <span className="sr-only">{fill(t.balance.finalBlock, { height: formatBaseUnits(balance.blockHeight, 0, { locale }).exact })}</span>
            </p>
          </>
        ) : (
          <p className="mt-2 text-lg font-semibold text-[var(--text-muted)]">{emptyBalance}</p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{statusBody}</p>
        {onRetry !== undefined && (
          <Button variant="secondary" className="mt-3" onClick={onRetry}>
            <Icon name="refresh" size={16} />
            {t.common.retry}
          </Button>
        )}
        {extra}
      </div>
      {actions !== undefined && <div className="mt-4">{actions}</div>}
    </section>
  );
}

/** Three real shortcuts under the balance: receive, request, pay. */
export function HomeActionsView({ receive, request, pay }: { readonly receive: string; readonly request: string; readonly pay: string }) {
  const t = useT();
  const actions: ReadonlyArray<{ href: string; icon: IconName; label: string }> = [
    { href: receive, icon: 'receive', label: t.home.receive },
    { href: request, icon: 'request', label: t.home.request },
    { href: pay, icon: 'scan', label: t.nav.pay },
  ];
  return (
    <nav aria-label={t.home.quickActionsLabel} className="grid grid-cols-3 gap-3" data-testid="home-actions">
      {actions.map((a) => (
        <Link
          key={a.label}
          href={a.href as Route}
          className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[var(--surface-1)] text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--taply-lime)]"
        >
          <span className="grid size-10 place-items-center rounded-full bg-[rgb(199_252_117/0.12)] text-[var(--taply-lime)]">
            <Icon name={a.icon} size={20} />
          </span>
          {a.label}
        </Link>
      ))}
    </nav>
  );
}

/** Taply Wallet not created yet (Testnet TaplyHomeCard intro markup). */
export function TaplyIntroView({ createHref, restoreHref }: { readonly createHref: string; readonly restoreHref: string }) {
  const t = useT();
  const n = t.walletNative;
  return (
    <section className="surface-hero p-5" aria-labelledby="taply-home-intro">
      <h2 id="taply-home-intro" className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="shield" size={20} className="text-[var(--taply-lime)]" />
        {n.intro.title}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{n.intro.body}</p>
      <div className="mt-4 flex flex-col gap-2">
        <ButtonLink href={createHref as Route} variant="primary" size="lg" block>
          {n.create}
        </ButtonLink>
        <ButtonLink href={restoreHref as Route} variant="ghost" block>
          {n.restore}
        </ButtonLink>
      </div>
    </section>
  );
}
