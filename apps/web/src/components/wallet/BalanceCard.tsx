'use client';

import Link from 'next/link';
import { Button } from '@/components/primitives/Button';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { BalanceHeroView, BalanceSkeleton } from '@/components/wallet/BalanceHeroView';
import { WalletKindBadge } from '@/components/wallet/WalletKind';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n/fill';
import type { Dictionary, ErrorCopy } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { displayableBalance } from '@/lib/near/balance';
import type { BalanceView } from '@/lib/near/balance';
import { classifyAccountId } from '@/lib/near/account';
import { getNearClient } from '@/lib/near/client';
import type { RpcErrorCode } from '@/lib/near/client';
import { useNativeBalance } from '@/lib/near/use-native-balance';
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
    return <ConnectedBalance accountId={state.session.accountId} walletName={state.session.walletName} />;
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

function ConnectedBalance({ accountId, walletName }: { readonly accountId: string; readonly walletName: string }) {
  const t = useT();
  const { locale } = useLocale();
  const { view, refreshing, refresh } = useNativeBalance(getNearClient(), accountId);
  const shown = displayableBalance(view);
  const hint = classifyAccountId(accountId);

  return (
    <BalanceHeroView
      accountId={accountId}
      badge={<WalletKindBadge kind="external" walletName={walletName} />}
      figure={
        shown === null
          ? null
          : {
              amountBaseUnits: shown.balance.amountYoctoNear,
              lockedBaseUnits: shown.balance.lockedYoctoNear,
              checkedAt: shown.checkedAt,
              blockLabel: fill(t.balance.finalBlock, { height: formatBaseUnits(shown.observedBlock.height, 0, { locale }).exact }),
            }
      }
      loading={view.kind === 'loading'}
      stale={view.kind === 'stale'}
      {...(view.kind === 'stale' ? { staleNote: errorCopyFor(t, view.errorCode).title } : {})}
      refreshing={refreshing}
      onRefresh={refresh}
      receiveHref="/receive"
      problem={
        <>
          <BalanceProblem view={view} retry={refresh} />
          {hint === 'likely_mainnet' && view.kind !== 'verified' && view.kind !== 'loading' && (
            <div className="mt-3">
              <InlineNotice copy={t.wallet.likelyMainnet} />
            </div>
          )}
        </>
      }
    />
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
