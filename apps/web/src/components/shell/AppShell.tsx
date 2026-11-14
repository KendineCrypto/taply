'use client';

import { FLAGS } from '@/lib/flags/features';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Monogram } from '@/components/experience/Basics';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { Sheet } from '@/components/shell/Sheet';
import { WalletKindBadge } from '@/components/wallet/WalletKind';
import { useWalletMode } from '@/components/wallet/taply/mode';
import { useT } from '@/lib/i18n/provider';
import { useWallet } from '@/lib/wallet/provider';
import { merchantCheckoutPath } from '@/lib/merchant/discovery';
import { LocaleSwitch, ShellFrame } from './ShellParts';
import type { ShellRoutes } from './ShellParts';

export { LocaleSwitch, NetworkBadge } from './ShellParts';

/**
 * Mobile-first shell (docs/UX_ONE_TAP_REDESIGN.md), Testnet wiring.
 *
 * Three persistent destinations only: Wallet, Tap (opens a sheet) and
 * Activity. Settings, wallet management, receive, language and help live in
 * the account menu (top right). The NEAR Testnet badge is always visible.
 * The frame, bars and Tap sheet live in ShellParts (shared with NEAR Mainnet).
 */
const TESTNET_ROUTES: ShellRoutes = {
  home: '/',
  activity: '/activity',
  request: '/request/new',
  send: '/send',
  protectedNew: FLAGS.protectedPay.enabled ? '/protected/new' : null,
  giftNew: FLAGS.gift.enabled ? '/gift/new' : null,
  pay: (id) => `/pay/${id}`,
  checkout: (accountId) => merchantCheckoutPath(accountId),
};

export function AppShell({ children }: { readonly children: ReactNode }) {
  return (
    <ShellFrame routes={TESTNET_ROUTES} accountMenu={<AccountMenu />}>
      {children}
    </ShellFrame>
  );
}

interface MenuLink {
  readonly href: '/wallet' | '/receive' | '/merchant' | '/protected/new' | '/contacts' | '/split' | '/recurring' | '/settings' | '/demo';
  readonly icon: IconName;
  readonly label: string;
  readonly body?: string;
}

/** Avatar button + account sheet. Shows which wallet is active; never switches it silently. */
function AccountMenu() {
  const t = useT();
  const m = t.oneTap.menu;
  const router = useRouter();
  const { state } = useWallet();
  const [mode] = useWalletMode();
  const [open, setOpen] = useState(false);
  const accountId = state.status === 'connected' ? state.session.accountId : null;

  const links: ReadonlyArray<MenuLink> = [
    { href: '/wallet', icon: 'wallet', label: m.wallet },
    { href: '/receive', icon: 'receive', label: m.receive },
    { href: '/merchant', icon: 'pay', label: t.commerce.merchant.title, body: t.commerce.merchant.menuBody },
    ...(FLAGS.protectedPay.enabled ? [{ href: '/protected/new' as const, icon: 'shield' as const, label: t.protectedFlow.title, body: t.protectedFlow.menuBody }] : []),
    // Monday sprint tools: local-only planning; each hides itself behind its kill switch.
    ...(FLAGS.contacts.enabled ? [{ href: '/contacts' as const, icon: 'wallet' as const, label: t.screens.contacts, body: t.routes.contacts }] : []),
    ...(FLAGS.splitPay.enabled ? [{ href: '/split' as const, icon: 'request' as const, label: t.tools.split.title, body: t.routes.split }] : []),
    ...(FLAGS.recurring.enabled ? [{ href: '/recurring' as const, icon: 'clock' as const, label: t.screens.recurring, body: t.routes.recurring }] : []),
    { href: '/settings', icon: 'settings', label: m.settings },
    { href: '/demo', icon: 'shield', label: m.help, body: m.helpBody },
  ];

  const go = (href: MenuLink['href']) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={accountId === null ? m.open : `${m.open}: ${accountId}`}
        className="pressable tap-target grid place-items-center rounded-full"
      >
        {accountId !== null && mode === 'external' ? (
          <Monogram accountId={accountId} size={34} />
        ) : (
          <span className="grid size-[34px] place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-secondary)] ring-1 ring-[var(--border-strong)]">
            <Icon name={mode === 'taply' ? 'shield' : 'wallet'} size={17} />
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={m.title} closeLabel={t.oneTap.sheet.close}>
        <div className="mb-3 flex items-center gap-3 rounded-[var(--radius-card)] bg-[var(--tone-neutral-bg)] p-3">
          {accountId !== null ? (
            <>
              <Monogram accountId={accountId} size={40} />
              <div className="min-w-0">
                <p className="chain-id truncate font-semibold" title={accountId}>
                  {accountId}
                </p>
                {mode === 'taply' ? (
                  <WalletKindBadge kind="native" />
                ) : (
                  <WalletKindBadge kind="external" {...(state.status === 'connected' ? { walletName: state.session.walletName } : {})} />
                )}
              </div>
            </>
          ) : (
            <p className="px-1 text-sm text-[var(--text-secondary)]">
              {mode === 'taply' ? <WalletKindBadge kind="native" /> : m.notConnected}
            </p>
          )}
        </div>
        <ul className="flex flex-col">
          {links.map((link, i) => (
            <li key={link.href} className="stagger-item" style={{ '--i': i } as CSSProperties}>
              <button
                type="button"
                onClick={() => go(link.href)}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-[var(--radius-control)] px-2 text-left hover:bg-[var(--tone-neutral-bg)]"
              >
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

