'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { Sheet, SheetAction } from '@/components/shell/Sheet';
import { useOnline } from '@/lib/hooks/browser';
import { LOCALES } from '@/lib/i18n/types';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetCopy, useMainnetLocale as useLocale } from '@/lib/mainnet/copy';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { useMainnetVault } from './Wallet';
import { useProductCopy } from './MainnetProduct';

/**
 * Shell for the NEAR Mainnet build, visually the same as the Testnet AppShell
 * (top bar, account menu, three-tab bar with the Tap sheet). It is a separate
 * implementation on purpose: no Testnet wallet adapter, vault, dictionary or
 * transaction code is imported. The network pill and a compact real-funds /
 * unaudited / cap line are on every screen; the signing status is derived from
 * the build's release configuration, never hard-coded.
 */
export function MainnetShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col lg:max-w-[560px]">
      <a href="#main" className="sr-only-focusable m-2 rounded bg-[var(--surface-2)] p-2 text-sm">
        Skip to content
      </a>
      <TopBar />
      <OfflineBanner />
      <main id="main" className="flex-1 px-4 pt-3 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-5">
        <div key={pathname} className="animate-page">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

/** True only when this build can actually sign (compile-time gate AND env flag). */
export function mainnetSigningOn(): boolean {
  return MAINNET_CONFIG.ok && MAINNET_CONFIG.signingEnabled;
}

function TopBar() {
  const c = useMainnetCopy();
  return (
    <header className="sticky top-0 z-20 bg-[rgb(11_18_14/0.86)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-5">
        <Link href="/m" aria-label="Taply" className="tap-target -ml-1 flex items-center px-1">
          <TaplyWordmark width={76} />
        </Link>
        <div className="flex items-center gap-2">
          <MainnetPill />
          <AccountMenu />
        </div>
      </div>
      {/* Material safety information stays on every screen, compact. */}
      <div role="note" className="flex items-start gap-1.5 px-4 pb-2 text-[11px] leading-snug text-[var(--text-muted)] sm:px-5">
        <Icon name="alert" size={13} className="mt-px shrink-0 text-[var(--tone-caution-fg)]" />
        <p>
          <span className="font-medium text-[var(--tone-caution-fg)]">{c.network.banner}.</span>{' '}
          {c.network.capLine} {mainnetSigningOn() ? c.network.signingOn : c.network.noGo}
        </p>
      </div>
      {MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures && (
        <p role="note" data-testid="fixture-banner" className="bg-[var(--surface-2)] px-4 py-1.5 text-center text-[12px] font-semibold tracking-wide text-[var(--taply-cream)] sm:px-5">
          {c.network.fixtureBanner}
        </p>
      )}
    </header>
  );
}

export function MainnetPill() {
  const c = useMainnetCopy();
  return (
    <span
      data-testid="network-pill"
      aria-label={c.network.pillAria}
      title={c.network.pillAria}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--taply-gold)]" />
      {c.network.pill}
    </span>
  );
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="mx-4 mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-3 text-sm text-[var(--tone-caution-fg)]">
      <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
      <span className="font-semibold">Offline</span>
    </div>
  );
}

/** Deterministic initials avatar (local, so no Testnet module is imported). */
export function MainnetMonogram({ accountId, size = 34 }: { readonly accountId: string; readonly size?: number }) {
  let h = 0;
  for (let i = 0; i < accountId.length; i++) h = (h * 31 + accountId.charCodeAt(i)) >>> 0;
  const hue = 70 + (h % 80);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full font-semibold uppercase text-[var(--taply-night)]"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 70% 72%)` }}
    >
      {accountId.replace(/[^a-z0-9]/gi, '').slice(0, 2) || 'T'}
    </span>
  );
}

export function useCurrentMainnetAccount(): { accountId: string | null; kind: 'taply' | 'external' | null } {
  const { identity } = useMainnetVault();
  const external = useMainnetWallet();
  if (identity !== null) return { accountId: identity.accountId, kind: 'taply' };
  if (external.accountId !== null) return { accountId: external.accountId, kind: 'external' };
  return { accountId: null, kind: null };
}

interface MenuLink { readonly href: string; readonly icon: IconName; readonly label: string; readonly body?: string }

function AccountMenu() {
  const p = useProductCopy();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { accountId, kind } = useCurrentMainnetAccount();
  const links: ReadonlyArray<MenuLink> = [
    { href: '/m/wallet', icon: 'wallet', label: p.wallet },
    { href: '/m/receive', icon: 'receive', label: p.receive },
    { href: '/m/merchant', icon: 'pay', label: p.merchant, body: p.merchantBody },
    { href: '/m/protected/new', icon: 'shield', label: p.protected, body: p.protectedBody },
    { href: '/m/contacts', icon: 'wallet', label: p.contacts },
    { href: '/m/split', icon: 'request', label: p.split },
    { href: '/m/recurring', icon: 'clock', label: p.recurring },
    { href: '/m/settings', icon: 'settings', label: p.settings },
  ];
  const go = (href: string) => { setOpen(false); router.push(href as Route); };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={accountId === null ? p.menuTitle : `${p.menuTitle}: ${accountId}`}
        className="pressable tap-target grid place-items-center rounded-full"
        data-testid="account-menu"
      >
        {accountId !== null ? (
          <MainnetMonogram accountId={accountId} size={34} />
        ) : (
          <span className="grid size-[34px] place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)]">
            <Icon name="wallet" size={17} />
          </span>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={p.menuTitle} closeLabel={p.closeSheet}>
        <div className="mb-3 flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--tone-neutral-bg)] p-3">
          {accountId !== null ? (
            <>
              <MainnetMonogram accountId={accountId} size={40} />
              <div className="min-w-0">
                <p className="chain-id truncate font-semibold" title={accountId}>{accountId}</p>
                <p className="text-xs text-[var(--text-muted)]">{kind === 'taply' ? 'Taply Wallet' : 'NEAR wallet'} · NEAR Mainnet</p>
              </div>
            </>
          ) : (
            <p className="px-1 text-sm text-[var(--text-secondary)]">{p.notConnected}</p>
          )}
        </div>
        <ul className="flex flex-col">
          {links.map((link, i) => (
            <li key={link.href} className="stagger-item" style={{ '--i': i } as CSSProperties}>
              <button type="button" onClick={() => go(link.href)} className="flex min-h-[52px] w-full items-center gap-3 rounded-[var(--radius-control)] px-2 text-left hover:bg-[var(--tone-neutral-bg)]">
                <Icon name={link.icon} size={20} className="shrink-0 text-[var(--text-secondary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.9375rem] font-medium">{link.label}</span>
                  {link.body !== undefined && <span className="block text-xs text-[var(--text-muted)]">{link.body}</span>}
                </span>
                <Icon name="chevron" size={16} className="shrink-0 text-[var(--text-muted)]" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <p className="mb-2 text-sm font-medium text-[var(--text-secondary)]">{p.menuLanguage}</p>
          <LocaleSwitch />
        </div>
      </Sheet>
    </>
  );
}

function LocaleSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="grid grid-cols-2 gap-2">
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={locale === code}
          onClick={() => { if (code !== locale) setLocale(code); }}
          className={`tap-target rounded-[var(--radius-control)] border px-3 text-sm font-medium ${locale === code ? 'border-[var(--taply-lime)] bg-[var(--tone-success-bg)] text-[var(--taply-lime)]' : 'border-[var(--border-strong)] text-[var(--text-secondary)]'}`}
        >
          {code === 'tr' ? 'Türkçe' : 'English'}
        </button>
      ))}
    </div>
  );
}

function BottomNav() {
  const p = useProductCopy();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[480px] border-t border-[var(--border-subtle)] bg-[rgb(17_28_21/0.94)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:bottom-5 lg:max-w-[360px] lg:rounded-full lg:border lg:pb-0 lg:shadow-[var(--shadow-float)]"
    >
      <ul className="grid grid-cols-3 items-end px-2">
        <li><NavLink href="/m" icon="wallet" label={p.wallet} active={pathname === '/m' || pathname.startsWith('/m/wallet')} /></li>
        <li className="flex justify-center">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="tap-button"
            className="pressable group -mt-5 flex flex-col items-center gap-1 pb-2 text-[11px] font-semibold text-[var(--text-primary)] lg:-mt-4"
          >
            <span className="grid size-[58px] place-items-center rounded-full bg-[var(--taply-lime)] text-[var(--taply-night)] shadow-[0_12px_28px_-10px_rgb(199_252_117/0.6)] ring-4 ring-[var(--surface-0)] transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
              <TapGlyph />
            </span>
            Tap
          </button>
        </li>
        <li><NavLink href="/m/activity" icon="activity" label={p.activity} active={pathname.startsWith('/m/activity')} /></li>
      </ul>
      <TapSheet open={open} onClose={() => setOpen(false)} />
    </nav>
  );
}

function NavLink({ href, icon, label, active }: { readonly href: string; readonly icon: IconName; readonly label: string; readonly active: boolean }) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-[62px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-200 ${active ? 'text-[var(--taply-lime)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
    >
      <span className={`grid h-7 w-12 place-items-center rounded-full transition-[background-color,transform] duration-200 ${active ? 'scale-100 bg-[var(--tone-success-bg)]' : 'scale-95'}`}>
        <Icon name={icon} size={22} />
      </span>
      {label}
    </Link>
  );
}

function TapGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9" />
      <path d="M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" opacity="0.55" />
    </svg>
  );
}

/** The Tap sheet: same actions and order as Testnet, routed to the Mainnet pages. */
function TapSheet({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const p = useProductCopy();
  const router = useRouter();
  const go = (href: string) => { onClose(); router.push(href as Route); };
  return (
    <Sheet open={open} onClose={onClose} title={p.tapTitle} description={p.tapBody} closeLabel={p.closeSheet}>
      <div className="flex flex-col gap-1">
        <SheetAction index={0} primary icon={<Icon name="request" size={22} />} label={p.request} body={p.requestBody} onSelect={() => go('/m/request/new')} />
        <SheetAction index={1} icon={<Icon name="scan" size={22} />} label={p.pay} body={p.payBody} onSelect={() => go('/m/scan')} />
        <SheetAction index={2} icon={<Icon name="send" size={22} />} label={p.send} body={p.sendBody} onSelect={() => go('/m/send')} />
        <SheetAction index={3} icon={<Icon name="shield" size={22} />} label={p.protected} body={p.protectedBody} onSelect={() => go('/m/protected/new')} />
        <SheetAction index={4} icon={<Icon name="gift" size={22} />} label={p.gift} body={p.giftBody} onSelect={() => go('/m/gift/new')} />
      </div>
    </Sheet>
  );
}
