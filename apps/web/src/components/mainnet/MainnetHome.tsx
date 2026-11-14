'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/primitives/Button';
import { mainnetSpendingBudget } from '@taply/near-client';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { ActivityList } from './Activity';
import { useActivation, useMainnetVault } from './Wallet';
import { MainnetMonogram, useCurrentMainnetAccount } from './MainnetShell';
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
      <HomeActions />
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


/** Balance hero, same layout as the Testnet Taply Wallet home card. Final-block reads only. */
function HomeHero() {
  const p = useProductCopy();
  const { locale } = useLocale();
  const { identity, unlocked } = useMainnetVault();
  const { accountId, kind } = useCurrentMainnetAccount();
  const [tick, setTick] = useState(0);
  const activation = useActivation(identity, tick);
  if (accountId === null) {
    return (
      <section className="surface-hero p-5" aria-labelledby="home-intro" data-testid="home-intro">
        <h2 id="home-intro" className="flex items-center gap-2 text-lg font-semibold">
          <Icon name="shield" size={20} className="text-[var(--taply-lime)]" />
          {p.heroIntro}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{p.heroIntroBody}</p>
        <div className="mt-4 flex flex-col gap-2">
          <ButtonLink href="/m/wallet/create" variant="primary" size="lg" block>{p.create}</ButtonLink>
          <ButtonLink href="/m/wallet/restore" variant="ghost" block>{p.restore}</ButtonLink>
        </div>
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <p className="mb-2 text-xs text-[var(--text-muted)]">{p.orConnect}</p>
          <WalletPanel />
        </div>
      </section>
    );
  }
  const active = activation.kind === 'active' ? activation : null;
  const spendable = active ? mainnetSpendingBudget(active.snapshot, '0') : null;
  const total = active ? formatMainnetAmount(active.snapshot.amountYocto, MAINNET_ASSETS.NEAR, locale) : null;
  const [figure, unit] = total ? [total.slice(0, total.lastIndexOf(' ')), 'NEAR'] : ['', ''];
  return (
    <section className="surface-hero p-5" aria-labelledby="home-identity" data-testid="home-hero">
      <div className="flex items-start gap-3">
        <MainnetMonogram accountId={accountId} size={44} />
        <div className="min-w-0 flex-1">
          <h2 id="home-identity" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--taply-lime)]">
            <Icon name={kind === 'taply' ? 'shield' : 'wallet'} size={15} />
            {kind === 'taply' ? 'Taply Wallet' : 'NEAR wallet'}
          </h2>
          <p className="chain-id mt-1 break-all text-xs text-[var(--text-secondary)]">{accountId}</p>
        </div>
        <ButtonLink href="/m/wallet" variant="ghost" className="px-3 text-xs">{p.manage}</ButtonLink>
      </div>
      {kind === 'taply' && (
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--text-secondary)]">{p.totalBalance}</p>
            <Button variant="ghost" className="px-2" onClick={() => setTick((t) => t + 1)} aria-label={p.refresh}>
              <Icon name="refresh" size={16} />
            </Button>
          </div>
          {total ? (
            <>
              <p className="display-amount mt-2 flex flex-wrap items-baseline gap-x-2">
                <span className="text-[2.75rem] min-[400px]:text-[3.25rem] [overflow-wrap:anywhere]">{figure}</span>
                <span className="text-lg text-[var(--text-muted)]">{unit}</span>
              </p>
              {spendable && <p className="mt-1 text-xs text-[var(--text-secondary)]">{p.available}: {formatMainnetAmount(spendable.availableYocto, MAINNET_ASSETS.NEAR, locale)}</p>}
              {active?.usdc != null && <p className="mt-1 text-xs text-[var(--text-secondary)]">{formatMainnetAmount(active.usdc, MAINNET_ASSETS.USDC, locale)}</p>}
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {activation.kind === 'checking' ? p.checking : activation.kind === 'not_activated' ? p.notActivated : p.unreadable}
            </p>
          )}
          {!unlocked && <p className="mt-2 text-xs text-[var(--text-muted)]">{p.vaultHelp.split('.')[0]}.</p>}
        </div>
      )}
    </section>
  );
}

/** The three real shortcuts under the balance (Receive, Request, Pay), as on Testnet. */
function HomeActions() {
  const p = useProductCopy();
  const actions: ReadonlyArray<{ href: string; icon: IconName; label: string }> = [
    { href: '/m/receive', icon: 'receive', label: p.receive },
    { href: '/m/request/new', icon: 'request', label: p.requestShort },
    { href: '/m/scan', icon: 'scan', label: p.payShort },
  ];
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-3 gap-3" data-testid="home-actions">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href as Route}
          className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[var(--surface-1)] px-1 text-center text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--taply-lime)]"
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
