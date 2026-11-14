'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Monogram } from '@/components/experience/Basics';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { Sheet } from '@/components/shell/Sheet';
import { LocaleSwitch, ShellFrame } from '@/components/shell/ShellParts';
import type { ShellRoutes } from '@/components/shell/ShellParts';
import { useT } from '@/lib/i18n/provider';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { useMainnetCopy } from '@/lib/mainnet/copy';
import { mainnetScanInput } from '@/lib/mainnet/product';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { useMainnetVault } from './Wallet';

/**
 * NEAR Mainnet wiring of the shared Taply shell (components/shell/ShellParts, the same
 * code the Testnet AppShell renders). Mainnet routes, Mainnet link parser, Mainnet
 * account menu. No Testnet wallet provider, vault or transaction module is imported.
 */
const MAINNET_ROUTES: ShellRoutes = {
  home: '/m',
  activity: '/m/activity',
  request: '/m/request/new',
  send: '/m/send',
  protectedNew: '/m/protected/new',
  giftNew: '/m/gift/new',
  pay: (id) => `/m/pay/${id}`,
  checkout: (accountId) => `/m/checkout/${accountId}`,
  parse: (text) => mainnetScanInput(text, typeof window === 'undefined' ? 'https://invalid.local' : window.location.origin),
};

/** True only when this build can actually sign (compile-time gate AND env flag). */
export function mainnetSigningOn(): boolean {
  return MAINNET_CONFIG.ok && MAINNET_CONFIG.signingEnabled;
}

export function MainnetShell({ children }: { readonly children: ReactNode }) {
  return (
    <ShellFrame routes={MAINNET_ROUTES} accountMenu={<AccountMenu />} notice={<SafetyLine />}>
      {children}
    </ShellFrame>
  );
}

/** Material safety information on every screen, compact (real funds, unaudited, cap, signing status). */
function SafetyLine() {
  const c = useMainnetCopy();
  return (
    <>
      <details role="note" className="group px-4 pb-2 text-[11px] leading-snug text-[var(--text-muted)] sm:px-5" data-testid="safety-line">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
          <Icon name="alert" size={13} className="shrink-0 text-[var(--tone-caution-fg)]" />
          <span className="min-w-0 truncate">
            <span className="font-medium text-[var(--tone-caution-fg)]">{c.network.banner}</span> · {c.network.capShort}
          </span>
          <Icon name="chevron" size={12} className="ml-auto shrink-0 rotate-90 transition-transform group-open:-rotate-90" />
        </summary>
        <p className="mt-1 pl-[19px]">{c.network.capLine} {mainnetSigningOn() ? c.network.signingOn : c.network.noGo}</p>
      </details>
      {MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures && (
        <p role="note" data-testid="fixture-banner" className="bg-[var(--surface-2)] px-4 py-1.5 text-center text-[12px] font-semibold tracking-wide text-[var(--taply-cream)] sm:px-5">
          {c.network.fixtureBanner}
        </p>
      )}
    </>
  );
}

export function useCurrentMainnetAccount(): { accountId: string | null; kind: 'taply' | 'external' | null } {
  const { identity } = useMainnetVault();
  const external = useMainnetWallet();
  if (identity !== null) return { accountId: identity.accountId, kind: 'taply' };
  if (external.accountId !== null) return { accountId: external.accountId, kind: 'external' };
  return { accountId: null, kind: null };
}

/** Kept for existing callers; the shared Monogram is the Testnet avatar. */
export function MainnetMonogram({ accountId, size = 34 }: { readonly accountId: string; readonly size?: number }) {
  return <Monogram accountId={accountId} size={size} />;
}

interface MenuLink { readonly href: string; readonly icon: IconName; readonly label: string; readonly body?: string }

/** Same markup as the Testnet account menu; Mainnet destinations and identity. */
function AccountMenu() {
  const t = useT();
  const m = t.oneTap.menu;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { accountId, kind } = useCurrentMainnetAccount();
  const links: ReadonlyArray<MenuLink> = [
    { href: '/m/wallet', icon: 'wallet', label: m.wallet },
    { href: '/m/receive', icon: 'receive', label: m.receive },
    { href: '/m/merchant', icon: 'pay', label: t.commerce.merchant.title, body: t.commerce.merchant.menuBody },
    { href: '/m/protected/new', icon: 'shield', label: t.protectedFlow.title, body: t.protectedFlow.menuBody },
    { href: '/m/contacts', icon: 'wallet', label: t.screens.contacts, body: t.routes.contacts },
    { href: '/m/split', icon: 'request', label: t.tools.split.title, body: t.routes.split },
    { href: '/m/recurring', icon: 'clock', label: t.screens.recurring, body: t.routes.recurring },
    { href: '/m/settings', icon: 'settings', label: m.settings },
  ];
  const go = (href: string) => { setOpen(false); router.push(href as never); };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={accountId === null ? m.open : `${m.open}: ${accountId}`}
        className="pressable tap-target grid place-items-center rounded-full"
        data-testid="account-menu"
      >
        {accountId !== null && kind === 'external' ? (
          <Monogram accountId={accountId} size={34} />
        ) : (
          <span className="grid size-[34px] place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)]">
            <Icon name={kind === 'taply' ? 'shield' : 'wallet'} size={17} />
          </span>
        )}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={m.title} closeLabel={t.oneTap.sheet.close}>
        <div className="mb-3 flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--tone-neutral-bg)] p-3">
          {accountId !== null ? (
            <>
              <Monogram accountId={accountId} size={40} />
              <div className="min-w-0">
                <p className="chain-id truncate font-semibold" title={accountId}>{accountId}</p>
                <p className="text-xs text-[var(--text-muted)]">{kind === 'taply' ? t.walletNative.taply : t.walletNative.external}</p>
              </div>
            </>
          ) : (
            <p className="px-1 text-sm text-[var(--text-secondary)]">{m.notConnected}</p>
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
          <p className="mb-2 text-sm font-medium text-[var(--text-secondary)]">{m.language}</p>
          <LocaleSwitch />
        </div>
      </Sheet>
    </>
  );
}
