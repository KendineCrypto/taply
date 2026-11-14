'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/shell/Icons';
import { QrCode } from '@/components/payments/QrCode';
import { FirstLaunchChooserView, HomeActionsView, IdentityCardView, WalletStatusPill } from '@/components/wallet/WalletHomeViews';
import { useT } from '@/lib/i18n/provider';
import { ActivityList } from './Activity';
import { useActivation, useMainnetVault } from './Wallet';
import { useCurrentMainnetAccount } from './MainnetShell';
import { Card } from '@/components/primitives/Surface';
import { assetById, formatMainnetAmount, MAINNET_ASSETS } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { commerceFixture, fixtureRequests } from '@/lib/mainnet/fixtures';
import { encodeSale } from '@/lib/mainnet/commerce';
import { Notice, short } from './bits';
import { WalletPanel } from './WalletPanel';
import { useProductCopy } from './MainnetProduct';
import { fill, useMainnetCopy, useMainnetLocale as useLocale } from '@/lib/mainnet/copy';

/** Accepts a bare 64-hex id or a Taply mainnet pay link on the same origin path. */
export function parsePayInput(text: string): string | null {
  const value = text.trim();
  if (/^[0-9a-f]{64}$/.test(value)) return value;
  const match = /^https:\/\/[^/\s]+\/m\/pay\/([0-9a-f]{64})\/?$/.exec(value);
  return match?.[1] ?? null;
}

export function MainnetHome() {
  const c = useMainnetCopy();
  const p = useProductCopy();
  const { locale } = useLocale();
  const router = useRouter();
  const { accountId } = useCurrentMainnetAccount();
  const [payInput, setPayInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [fixtures] = useState(() => (MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures ? fixtureRequests(Date.now()) : []));
  // FIXTURE sale bound to a commerce session (Codex binding); its link carries the reviewed commitment in the fragment.
  const [sale] = useState(() => {
    if (!(MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures)) return null;
    const f = commerceFixture(Date.now());
    return { href: `/m/pay/${f.request.terms.id}?m=${f.session.merchantAccountId}#c=${encodeSale({ session: f.session, termsHash: f.termsHash })}`, amount: f.request.terms.amountBaseUnits };
  });

  if (!MAINNET_CONFIG.ok) return <Notice tone="danger">{c.home.configBroken}</Notice>;
  const contract = MAINNET_CONFIG.contract;

  return (
    <div className="flex flex-col gap-8 pt-2">
      <h1 className="sr-only">{c.home.title}</h1>
      <HomeHero />
      {accountId !== null && <HomeActionsView receive="/m/receive" request="/m/request/new" pay="/m/scan" />}
      <section aria-labelledby="home-recent" className="flex flex-col gap-3">
        <h2 id="home-recent" className="text-sm font-semibold text-[var(--text-secondary)]">{p.recent}</h2>
        <ActivityList removeLabel={p.remove} />
      </section>
      <details className="rounded-[var(--radius-card)] bg-[var(--surface-1)] p-4 text-sm">
        <summary className="cursor-pointer font-medium text-[var(--text-secondary)]">{p.details}</summary>
        <div className="mt-3 flex flex-col gap-4">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const id = parsePayInput(payInput);
              setInvalid(id === null);
              if (id !== null) router.push(`/m/pay/${id}` as Route);
            }}
          >
            <label htmlFor="pay-input" className="text-[13px] text-[var(--text-secondary)]">{c.home.payHint}</label>
            <input
              id="pay-input"
              value={payInput}
              onChange={(e) => setPayInput(e.target.value)}
              placeholder={c.home.payPlaceholder}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid}
              className="min-h-[var(--tap-target)] rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 font-mono text-[13px]"
            />
            {invalid && <p role="alert" className="text-[13px] text-[var(--tone-danger-fg)]">{c.home.payInvalid}</p>}
            <Button type="submit" variant="secondary">{c.home.payOpen}</Button>
          </form>
      <div>
        <h2 className="text-[15px] font-semibold">{c.home.contractTitle}</h2>
        <p data-testid="contract-status" className="mt-1 break-all text-[13px] text-[var(--text-secondary)]">
          {contract.status === 'configured'
            ? fill(c.home.contractConfigured, { account: contract.accountId, hash: short(contract.expectedCodeHash) })
            : contract.status === 'invalid'
              ? c.home.contractInvalid
              : c.home.contractNotConfigured}
        </p>
      </div>
        </div>
      </details>

      {fixtures.length > 0 && (
        <Card>
          <h2 className="text-[15px] font-semibold">{c.home.fixturesTitle}</h2>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{c.home.fixturesHint}</p>
          <ul className="mt-3 flex flex-col gap-1.5" data-testid="fixture-list">
            {fixtures.map(({ scenario, request }) => {
              const asset = assetById(request.terms.assetId)!;
              return (
                <li key={scenario.name}>
                  <Link
                    href={`/m/pay/${request.terms.id}` as Route}
                    className="pressable flex min-h-[var(--tap-target)] items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3 py-2 text-[13px]"
                  >
                    <span className="font-mono">{scenario.name}</span>
                    <span className="text-[var(--text-secondary)]">{formatMainnetAmount(request.terms.amountBaseUnits, asset, locale)}</span>
                  </Link>
                </li>
              );
            })}
            {sale !== null && (
              <li key="usdc-commerce-sale">
                <a href={sale.href} className="pressable flex min-h-[var(--tap-target)] items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3 py-2 text-[13px]">
                  <span className="font-mono">usdc-commerce-sale</span>
                  <span className="text-[var(--text-secondary)]">{formatMainnetAmount(sale.amount, MAINNET_ASSETS.USDC, locale)}</span>
                </a>
              </li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}


/**
 * Wallet home hero: the Testnet first-launch chooser / Taply Wallet intro / identity card
 * (components/wallet/WalletHomeViews), fed with Mainnet vault identity and FINAL-block reads.
 */
function HomeHero() {
  const t = useT();
  const n = t.walletNative;
  const { identity, unlocked } = useMainnetVault();
  const { accountId, kind } = useCurrentMainnetAccount();
  const [tick, setTick] = useState(0);
  const activation = useActivation(identity, tick);
  if (accountId === null) {
    return <FirstLaunchChooserView externalSlot={<WalletPanel primary />} taplyAvailable createHref="/m/wallet/create" restoreHref="/m/wallet/restore" />;
  }
  if (kind !== 'taply') {
    return <section className="surface-hero p-5" data-testid="home-external"><WalletPanel /></section>;
  }
  const active = activation.kind === 'active' ? activation : null;
  const statusPill = active
    ? <WalletStatusPill tone="success" icon="check" label={n.status.provisioned.title} />
    : activation.kind === 'not_activated'
      ? <WalletStatusPill tone="caution" icon="alert" label={n.status.localOnly.title} />
      : <WalletStatusPill tone="neutral" icon="clock" label={n.status.unknown.title} />;
  const lockPill = (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${unlocked ? 'bg-[var(--surface-2)] text-[var(--text-primary)] ring-1 ring-[var(--border-strong)]' : 'bg-[var(--tone-neutral-bg)] text-[var(--text-secondary)]'}`}>
      <Icon name={unlocked ? 'shield' : 'clock'} size={13} />
      {unlocked ? n.lock.unlocked : n.lock.locked}
    </span>
  );
  return (
    <IdentityCardView
      accountId={accountId}
      badges={<>{statusPill}{lockPill}</>}
      balance={active ? { baseUnits: active.snapshot.amountYocto, blockTimestampNs: active.snapshot.blockTimestampNs, blockHeight: active.snapshot.blockHeight } : null}
      emptyBalance={activation.kind === 'not_activated' ? n.home.noBalance : '—'}
      statusBody={active ? n.status.provisioned.body : activation.kind === 'not_activated' ? n.status.localOnly.body : n.status.unknown.body}
      onRefresh={() => setTick((x) => x + 1)}
      {...(activation.kind === 'unreadable' ? { onRetry: () => setTick((x) => x + 1) } : {})}
      extra={activation.kind === 'not_activated' ? <div className="mt-4 flex justify-center"><QrCode value={accountId} label={n.identityLabel} /></div> : undefined}
      actions={
        <Link href="/m/wallet" className="tap-target inline-flex items-center gap-1.5 rounded-full px-3 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)] hover:text-[var(--text-primary)]">
          {unlocked ? t.walletUx.home.manage : n.home.lockedHint}
          <Icon name="chevron" size={14} />
        </Link>
      }
    />
  );
}
