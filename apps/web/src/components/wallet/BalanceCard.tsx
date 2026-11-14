'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Spinner } from '@/components/primitives/Button';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { Monogram } from '@/components/experience/Basics';
import { WalletKindBadge } from '@/components/wallet/WalletKind';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n/fill';
import type { Dictionary, ErrorCopy, Locale } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { displayableBalance } from '@/lib/near/balance';
import type { BalanceView, VerifiedBalance } from '@/lib/near/balance';
import { classifyAccountId } from '@/lib/near/account';
import { getNearClient } from '@/lib/near/client';
import type { RpcErrorCode } from '@/lib/near/client';
import { useNativeBalance } from '@/lib/near/use-native-balance';
import { NEAR_NATIVE } from '@/lib/protocol';
import { useWallet } from '@/lib/wallet/provider';

/**
 * Wallet home hero (UX_FLOWS screen 03).
 *
 * The number on this card is the most trusted-looking thing in the app, so it
 * is rendered only from `displayableBalance()`, i.e. a finalized Testnet RPC
 * read of the connected account. Every other state shows words, never digits.
 */
export function BalanceCard() {
  const t = useT();
  const { state } = useWallet();

  if (state.status === 'connected') {
    return (
      <section aria-labelledby="balance-title" className="animate-rise pt-3">
        <ConnectedBalance accountId={state.session.accountId} walletName={state.session.walletName} />
      </section>
    );
  }

  return (
    <section aria-labelledby="balance-title" className="surface-hero animate-rise p-5 pb-6">
      <div className="relative">
        <h2 id="balance-title" className="text-sm font-medium text-[var(--text-secondary)]">
          {t.balance.title}
        </h2>
        {state.status === 'disabled' ? (
          <div className="mt-4">
            <InlineNotice copy={t.wallet.disabled} tone="neutral" />
          </div>
        ) : state.status === 'restoring' ? (
          <BalanceSkeleton label={t.wallet.restoring} />
        ) : (
          <Disconnected />
        )}
      </div>
    </section>
  );
}

function Disconnected() {
  const t = useT();
  return (
    <div className="mt-3">
      <p className="text-[1.5rem] font-semibold leading-tight tracking-tight">{t.walletUx.onboarding.title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{t.wallet.connectBody}</p>
      <div className="mt-4 flex flex-col gap-3">
        <WalletErrorNotice />
        <ConnectWalletButton />
        <Link
          href="/wallet"
          className="tap-target inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {t.walletUx.onboarding.openWallet}
          <Icon name="chevron" size={16} />
        </Link>
      </div>

    </div>
  );
}

function BalanceSkeleton({ label }: { readonly label: string }) {
  return (
    <div role="status" aria-busy="true" className="mt-3">
      <span className="sr-only">{label}</span>
      <div className="h-11 w-48 animate-pulse rounded-lg bg-[var(--tone-neutral-bg)]" />
      <div className="mt-3 h-4 w-36 animate-pulse rounded bg-[var(--tone-neutral-bg)]" />
    </div>
  );
}

function ConnectedBalance({ accountId, walletName }: { readonly accountId: string; readonly walletName: string }) {
  const t = useT();
  const { view, refreshing, refresh } = useNativeBalance(getNearClient(), accountId);
  const shown = displayableBalance(view);
  const hint = classifyAccountId(accountId);

  return (
    <>
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-1">
          <h2 id="balance-title" className="text-sm font-medium text-[var(--text-secondary)]">
            {t.walletUx.home.totalBalance}
          </h2>
          <Button
            variant="ghost"
            className="px-2"
            onClick={refresh}
            disabled={refreshing}
            aria-label={refreshing ? t.balance.refreshing : t.balance.refresh}
          >
            {refreshing ? <Spinner /> : <Icon name="refresh" size={16} />}
          </Button>
        </div>

        <div aria-live="polite" aria-busy={view.kind === 'loading' || undefined} className="flex w-full flex-col items-center">
          {shown !== null ? (
            <BalanceFigure verified={shown} stale={view.kind === 'stale'} />
          ) : view.kind === 'loading' ? (
            <BalanceSkeleton label={t.balance.loading} />
          ) : (
            <div className="mt-2">
              <p className="text-[3rem] font-semibold leading-none text-[var(--text-muted)]" aria-hidden="true">
                —
              </p>
              <span className="sr-only">{t.balance.notShown}</span>
            </div>
          )}
        </div>
      </div>

      {view.kind === 'stale' && (
        <p className="mt-2 text-center text-xs text-[var(--tone-caution-fg)]">{errorCopyFor(t, view.errorCode).title}</p>
      )}

      <BalanceProblem view={view} retry={refresh} />

      {hint === 'likely_mainnet' && view.kind !== 'verified' && view.kind !== 'loading' && (
        <div className="mt-3">
          <InlineNotice copy={t.wallet.likelyMainnet} />
        </div>
      )}

      {/* Identity: tap for the receive address and QR code. */}
      <Link
        href="/receive"
        className="pressable mx-auto mt-6 flex w-full max-w-sm items-center gap-3 rounded-full bg-[var(--tone-neutral-bg)] py-2 pl-2 pr-4 ring-1 ring-[var(--border-subtle)] hover:ring-[var(--border-strong)]"
      >
        <Monogram accountId={accountId} size={36} />
        <span className="min-w-0 flex-1 text-left">
          <span className="chain-id block truncate text-sm font-semibold text-[var(--text-primary)]" title={accountId}>
            {accountId}
          </span>
          <WalletKindBadge kind="external" walletName={walletName} />
        </span>
        <span className="sr-only">{t.oneTap.home.accountRowHint}</span>
        <Icon name="scan" size={18} className="shrink-0 text-[var(--text-secondary)]" />
      </Link>
    </>
  );
}

function BalanceFigure({ verified, stale }: { readonly verified: VerifiedBalance; readonly stale: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const [exact, setExact] = useState(false);
  const formatted = formatBaseUnits(verified.balance.amountYoctoNear, NEAR_NATIVE.decimals, {
    locale,
    maxFractionDigits: 4,
  });
  const locked = verified.balance.lockedYoctoNear !== '0';
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
            {fill(t.balance.staleAt, { time: formatTime(verified.checkedAt, locale) })}
          </span>
        ) : (
          <>
            <Icon name="check" size={14} className="text-[var(--taply-lime)]" />
            {/* Block height is evidence, not headline: tooltip + screen readers only. */}
            <span title={fill(t.balance.finalBlock, { height: formatBaseUnits(verified.observedBlock.height, 0, { locale }).exact })}>
              {fill(t.balance.verifiedAt, { time: formatTime(verified.checkedAt, locale) })}
            </span>
            <span className="sr-only">{fill(t.balance.finalBlock, { height: formatBaseUnits(verified.observedBlock.height, 0, { locale }).exact })}</span>
          </>
        )}
      </p>

      {locked && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {t.balance.lockedLabel}:{' '}
          <span className="tabular-nums">
            {formatBaseUnits(verified.balance.lockedYoctoNear, NEAR_NATIVE.decimals, { locale }).display}
          </span>{' '}
          {NEAR_NATIVE.symbol}
        </p>
      )}
      {exact && <p className="mt-1 max-w-xs text-xs leading-relaxed text-[var(--text-muted)]">{t.balance.storageNote}</p>}
    </div>
  );
}

function BalanceProblem({ view, retry }: { readonly view: BalanceView; readonly retry: () => void }) {
  const t = useT();
  let copy: ErrorCopy | null = null;
  let canRetry = true;

  switch (view.kind) {
    case 'not_found':
      copy = t.balance.notFound;
      break;
    case 'network_mismatch':
      copy = t.balance.networkMismatch;
      break;
    case 'unverified':
      copy = t.balance.unverified;
      break;
    case 'error':
      copy = errorCopyFor(t, view.errorCode);
      canRetry = view.errorCode !== 'INVALID_CONFIG';
      break;
    default:
      return null;
  }

  return (
    <div className="mt-3">
      <InlineNotice
        copy={copy}
        action={
          canRetry ? (
            <Button variant="secondary" onClick={retry}>
              <Icon name="refresh" size={16} />
              {t.common.retry}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

function errorCopyFor(t: Dictionary, code: RpcErrorCode): ErrorCopy {
  if (code === 'RPC_RATE_LIMITED') return t.balance.rateLimited;
  if (code === 'INVALID_CONFIG') return t.balance.configInvalid;
  return t.balance.readFailed;
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
