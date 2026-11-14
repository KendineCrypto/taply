'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Spinner } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { Monogram } from '@/components/experience/Basics';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n/fill';
import type { Locale } from '@/lib/i18n/types';
import { useLocale, useT } from '@/lib/i18n/provider';
import { NEAR_NATIVE } from '@/lib/protocol';

/**
 * The connected-wallet balance hero (UX_FLOWS screen 03): big NEAR figure, refresh,
 * "checked at" line and the account row that opens Receive. Presentational only:
 * the Testnet and NEAR Mainnet builds pass their own FINAL-block reads and links.
 * A figure is passed only for a verified read; every other state shows words.
 */
export interface BalanceFigureData {
  readonly amountBaseUnits: string;
  readonly lockedBaseUnits: string;
  /** ISO time of the read. */
  readonly checkedAt: string;
  /** Block evidence for tooltips and screen readers ("Final block …"). */
  readonly blockLabel: string;
}

export function BalanceHeroView({
  accountId,
  badge,
  figure,
  loading,
  stale = false,
  staleNote,
  refreshing,
  onRefresh,
  problem,
  receiveHref,
  below,
}: {
  readonly accountId: string;
  readonly badge: ReactNode;
  readonly figure: BalanceFigureData | null;
  readonly loading: boolean;
  readonly stale?: boolean;
  readonly staleNote?: string;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly problem?: ReactNode;
  readonly receiveHref: string;
  /** Extra balance lines under the figure (e.g. NEAR Mainnet USDC). */
  readonly below?: ReactNode;
}) {
  const t = useT();
  return (
    <section aria-labelledby="balance-title" className="animate-rise pt-3" data-testid="balance-hero">
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-1">
          <h2 id="balance-title" className="text-sm font-medium text-[var(--text-secondary)]">
            {t.walletUx.home.totalBalance}
          </h2>
          <Button
            variant="ghost"
            className="px-2"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={refreshing ? t.balance.refreshing : t.balance.refresh}
          >
            {refreshing ? <Spinner /> : <Icon name="refresh" size={16} />}
          </Button>
        </div>

        <div aria-live="polite" aria-busy={loading || undefined} className="flex w-full flex-col items-center">
          {figure !== null ? (
            <BalanceFigure figure={figure} stale={stale} />
          ) : loading ? (
            <BalanceSkeleton label={t.balance.loading} />
          ) : (
            <div className="mt-2">
              <p className="text-[3rem] font-semibold leading-none text-[var(--text-muted)]" aria-hidden="true">
                —
              </p>
              <span className="sr-only">{t.balance.notShown}</span>
            </div>
          )}
          {below}
        </div>
      </div>

      {stale && staleNote !== undefined && <p className="mt-2 text-center text-xs text-[var(--tone-caution-fg)]">{staleNote}</p>}

      {problem}

      {/* Identity: tap for the receive address and QR code. */}
      <Link
        href={receiveHref as Route}
        className="pressable mx-auto mt-6 flex w-full max-w-sm items-center gap-3 rounded-full bg-[var(--tone-neutral-bg)] py-2 pl-2 pr-4 ring-1 ring-[var(--border-subtle)] hover:ring-[var(--border-strong)]"
        data-testid="account-row"
      >
        <Monogram accountId={accountId} size={36} />
        <span className="min-w-0 flex-1 text-left">
          <span className="chain-id block truncate text-sm font-semibold text-[var(--text-primary)]" title={accountId}>
            {accountId}
          </span>
          {badge}
        </span>
        <span className="sr-only">{t.oneTap.home.accountRowHint}</span>
        <Icon name="scan" size={18} className="shrink-0 text-[var(--text-secondary)]" />
      </Link>
    </section>
  );
}

export function BalanceSkeleton({ label }: { readonly label: string }) {
  return (
    <div role="status" aria-busy="true" className="mt-3">
      <span className="sr-only">{label}</span>
      <div className="h-11 w-48 animate-pulse rounded-lg bg-[var(--tone-neutral-bg)]" />
      <div className="mt-3 h-4 w-36 animate-pulse rounded bg-[var(--tone-neutral-bg)]" />
    </div>
  );
}

function BalanceFigure({ figure, stale }: { readonly figure: BalanceFigureData; readonly stale: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const [exact, setExact] = useState(false);
  const formatted = formatBaseUnits(figure.amountBaseUnits, NEAR_NATIVE.decimals, {
    locale,
    maxFractionDigits: 4,
  });
  const locked = figure.lockedBaseUnits !== '0';
  const value = exact ? formatted.exact : formatted.display;
  const [whole, fraction] = splitDecimal(value, locale);

  return (
    <div className="mt-1 flex flex-col items-center">
      <button
        type="button"
        onClick={() => setExact((v) => !v)}
        aria-pressed={exact}
        className="block max-w-full rounded-lg text-center"
        title={formatted.exact}
      >
        <span className={`flex flex-wrap items-baseline justify-center gap-x-2 ${stale ? 'opacity-60' : ''}`}>
          <span className={`display-amount break-all ${exact ? 'text-[2rem]' : 'text-[3.25rem] min-[400px]:text-[3.75rem]'}`}>
            {whole}
            {fraction !== null && <span className="text-[var(--text-muted)]">{fraction}</span>}
            {!exact && formatted.truncated && (
              <span aria-hidden="true" className="text-[1.5rem] text-[var(--text-muted)]">
                …
              </span>
            )}
          </span>
          <span className="text-lg font-medium text-[var(--text-secondary)]">{NEAR_NATIVE.symbol}</span>
        </span>
        <span className="sr-only">
          {formatted.exact} {NEAR_NATIVE.symbol}. {t.common.exactBaseUnits}: {formatted.baseUnits}
        </span>
      </button>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        {stale ? (
          <span className="text-[var(--tone-caution-fg)]">
            {fill(t.balance.staleAt, { time: formatTime(figure.checkedAt, locale) })}
          </span>
        ) : (
          <>
            <Icon name="check" size={14} className="text-[var(--taply-lime)]" />
            {/* Block evidence is not headline: tooltip + screen readers only. */}
            <span title={figure.blockLabel}>{fill(t.balance.verifiedAt, { time: formatTime(figure.checkedAt, locale) })}</span>
            <span className="sr-only">{figure.blockLabel}</span>
          </>
        )}
      </p>

      {locked && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {t.balance.lockedLabel}:{' '}
          <span className="tabular-nums">{formatBaseUnits(figure.lockedBaseUnits, NEAR_NATIVE.decimals, { locale }).display}</span>{' '}
          {NEAR_NATIVE.symbol}
        </p>
      )}
      {exact && <p className="mt-1 max-w-xs text-xs leading-relaxed text-[var(--text-muted)]">{t.balance.storageNote}</p>}
    </div>
  );
}

function splitDecimal(value: string, locale: Locale): [string, string | null] {
  const separator = locale === 'tr' ? ',' : '.';
  const index = value.lastIndexOf(separator);
  return index === -1 ? [value, null] : [value.slice(0, index), value.slice(index)];
}

function formatTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (globalThis.Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
}
