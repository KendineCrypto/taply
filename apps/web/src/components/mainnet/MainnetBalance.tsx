'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { readMainnetDisplayBalances } from '@/lib/mainnet/balance-read';
import { Button } from '@/components/primitives/Button';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Icon } from '@/components/shell/Icons';
import { BalanceHeroView } from '@/components/wallet/BalanceHeroView';
import { formatBaseUnits } from '@/lib/format/amount';
import { nsToDate } from '@/lib/format/time';
import { fill } from '@/lib/i18n/fill';
import { useLocale, useT } from '@/lib/i18n/provider';
import { MAINNET_ASSETS } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';

/** A FINAL-block NEAR Mainnet read of one account (NEAR + USDC), or why it is not shown. */
export type MainnetBalanceRead =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ok'; readonly native: string; readonly locked: string; readonly usdc: string; readonly blockHash: string; readonly timestampNs: string };

export function useMainnetBalance(accountId: string | null, tick: number): MainnetBalanceRead {
  const [state, setState] = useState<{ key: string; value: MainnetBalanceRead } | null>(null);
  const key = `${accountId ?? ''}|${tick}`;
  useEffect(() => {
    const profile = MAINNET_CONFIG.ok ? { network: 'near-mainnet' as const, rpcUrl: MAINNET_CONFIG.rpcUrl, rpcProviderId: MAINNET_CONFIG.rpcProviderId } : null;
    if (accountId === null || profile === null) return;
    let live = true;
    readMainnetDisplayBalances(accountId, profile)
      .then((r) => { if (live) setState({ key, value: { kind: 'ok', native: r.native, locked: r.locked, usdc: r.usdc, blockHash: r.blockHash, timestampNs: r.timestampNs } }); })
      .catch(() => { if (live) setState({ key, value: { kind: 'error' } }); });
    return () => { live = false; };
  }, [accountId, key]);
  return state?.key === key ? state.value : { kind: 'loading' };
}

/** The Testnet balance hero fed with a NEAR Mainnet FINAL-block read (USDC under the NEAR figure). */
export function MainnetBalanceHero({ accountId, badge, receiveHref = '/m/receive' }: { readonly accountId: string; readonly badge: ReactNode; readonly receiveHref?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [tick, setTick] = useState(0);
  const read = useMainnetBalance(accountId, tick);
  const refresh = () => setTick((x) => x + 1);
  return (
    <BalanceHeroView
      accountId={accountId}
      badge={badge}
      figure={read.kind === 'ok' ? {
        amountBaseUnits: read.native,
        lockedBaseUnits: read.locked,
        checkedAt: nsToDate(read.timestampNs).toISOString(),
        blockLabel: fill(t.balance.finalBlock, { height: `${read.blockHash.slice(0, 8)}…` }),
      } : null}
      loading={read.kind === 'loading'}
      refreshing={read.kind === 'loading'}
      onRefresh={refresh}
      receiveHref={receiveHref}
      below={read.kind === 'ok' ? (
        <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="balance-usdc">
          <span className="tabular-nums">{formatBaseUnits(read.usdc, MAINNET_ASSETS.USDC.decimals, { locale }).display}</span> USDC
        </p>
      ) : undefined}
      problem={read.kind === 'error' ? (
        <div className="mt-3">
          <InlineNotice
            copy={t.balance.readFailed}
            action={<Button variant="secondary" onClick={refresh}><Icon name="refresh" size={16} />{t.common.retry}</Button>}
          />
        </div>
      ) : undefined}
    />
  );
}
