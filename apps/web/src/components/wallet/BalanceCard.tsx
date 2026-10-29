'use client';

import { useState } from 'react';
import { Button, Spinner } from '@/components/primitives/Button';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { AccountChip } from '@/components/wallet/AccountChip';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n';
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

  return (
    <section
      aria-labelledby="balance-title"
      className="relative overflow-hidden rounded-[24px] border border-[var(--border-subtle)] bg-[linear-gradient(155deg,#24392b_0%,var(--taply-forest)_58%,#0e1812_100%)] p-5 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.8)]"
    >
      {/* Soft brand-lime light in the corner; decorative only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[radial-gradient(circle,rgb(199_252_117/0.16)_0%,transparent_70%)]"
      />
      <div className="relative">
        {state.status === 'connected' ? (
          <ConnectedBalance accountId={state.session.accountId} walletName={state.session.walletName} />
        ) : (
          <>
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
          </>
        )}
      </div>
    </section>
  );
}

function Disconnected() {
  const t = useT();
  return (
    <div className="mt-3">
      <p className="text-[1.375rem] font-semibold leading-tight tracking-tight">{t.wallet.connectTitle}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{t.wallet.connectBody}</p>
      <div className="mt-4 flex flex-col gap-3">
        <WalletErrorNotice />
        <ConnectWalletButton />
      </div>
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[var(--text-muted)]">
        <Icon name="check" size={14} className="mt-0.5 shrink-0 text-[var(--taply-lime)]" />
        {t.wallet.noKeysNote}
      </p>
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
      <div className="flex items-center justify-between gap-2">
        <h2 id="balance-title" className="text-sm font-medium text-[var(--text-secondary)]">
          {t.balance.title}
        </h2>
        <Button
          variant="ghost"
          className="-mr-2 px-2"
          onClick={refresh}
          disabled={refreshing}
          aria-label={refreshing ? t.balance.refreshing : t.balance.refresh}
        >
          {refreshing ? <Spinner /> : <Icon name="refresh" size={18} />}
        </Button>
      </div>

      <div aria-live="polite" aria-busy={view.kind === 'loading' || undefined}>
        {shown !== null ? (
          <BalanceFigure verified={shown} stale={view.kind === 'stale'} />
        ) : view.kind === 'loading' ? (
          <BalanceSkeleton label={t.balance.loading} />
        ) : (
          <div className="mt-3">
            <p className="text-[2.25rem] font-semibold leading-none text-[var(--text-muted)]" aria-hidden="true">
              —
            </p>
            <span className="sr-only">{t.balance.notShown}</span>
          </div>
        )}
      </div>

      {view.kind === 'stale' && (
        <p className="mt-2 text-xs text-[var(--tone-caution-fg)]">{errorCopyFor(t, view.errorCode).title}</p>
      )}

      <BalanceProblem view={view} retry={refresh} />

      {hint === 'likely_mainnet' && view.kind !== 'verified' && view.kind !== 'loading' && (
        <div className="mt-3">
          <InlineNotice copy={t.wallet.likelyMainnet} />
        </div>
      )}

      <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
        <AccountChip accountId={accountId} caption={fill(t.wallet.connectedWith, { wallet: walletName })} />
      </div>
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
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExact((v) => !v)}
        aria-pressed={exact}
        className="block max-w-full rounded-lg text-left"
        title={formatted.exact}
      >
        <span className={`flex flex-wrap items-baseline gap-x-2 ${stale ? 'opacity-60' : ''}`}>
          <span className="break-all text-[2.5rem] font-semibold leading-[1.05] tracking-tight tabular-nums">
            {whole}
            {fraction !== null && <span className="text-[1.5rem] text-[var(--text-secondary)]">{fraction}</span>}
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

      <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        {stale ? (
          <span className="text-[var(--tone-caution-fg)]">
            {fill(t.balance.staleAt, { time: formatTime(verified.checkedAt, locale) })}
          </span>
        ) : (
          <>
            <Icon name="check" size={14} className="text-[var(--taply-lime)]" />
            {fill(t.balance.verifiedAt, {
              height: formatBaseUnits(verified.observedBlock.height, 0, { locale }).exact,
              time: formatTime(verified.checkedAt, locale),
            })}
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
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{t.balance.storageNote}</p>
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
