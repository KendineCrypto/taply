'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { useOnline } from '@/lib/hooks/browser';
import { useLocale, useT } from '@/lib/i18n/provider';
import { LOCALES, DICTIONARIES } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import { shortAccountId } from '@/lib/near/account';
import { useWallet } from '@/lib/wallet/provider';

/**
 * Mobile-first shell. Target widths 360 / 390 / 430px with a desktop-responsive
 * centred column (CLAUDE.md, UX_FLOWS.md).
 *
 * Chrome requirements met here: wordmark, persistent NEAR Testnet badge, wallet
 * account short ID, bottom navigation with >= 44px targets, a skip link, a
 * single <main> landmark, and safe-area insets for notched / home-bar devices.
 */

interface NavItem {
  readonly href: '/' | '/pay' | '/scan' | '/activity' | '/settings';
  readonly labelKey: 'home' | 'pay' | 'scan' | 'activity' | 'settings';
  readonly icon: IconName;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/', labelKey: 'home', icon: 'home' },
  { href: '/pay', labelKey: 'pay', icon: 'pay' },
  { href: '/scan', labelKey: 'scan', icon: 'scan' },
  { href: '/activity', labelKey: 'activity', icon: 'activity' },
  { href: '/settings', labelKey: 'settings', icon: 'settings' },
];

export function AppShell({ children }: { readonly children: ReactNode }) {
  const t = useT();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <a
        href="#main"
        className="sr-only-focusable m-2 rounded bg-[var(--surface-2)] p-2 text-sm"
      >
        {t.app.skipToContent}
      </a>

      <TopBar />
      <OfflineBanner />

      <main
        id="main"
        className="flex-1 px-4 pt-3 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-5"
      >
        {children}
      </main>

      <BottomNav />
    </div>
  );
}

function TopBar() {
  const t = useT();

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[rgb(11_18_14/0.88)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-5">
        <Link href="/" aria-label={t.app.name} className="tap-target -ml-1 flex items-center px-1">
          <TaplyWordmark width={84} />
        </Link>
        <div className="flex items-center gap-2">
          <NetworkBadge />
          <WalletStatus />
        </div>
      </div>
    </header>
  );
}

/**
 * The network badge is always visible and never derived from a wallet response.
 * It states the only network this build supports (freeze section 1).
 */
export function NetworkBadge() {
  const t = useT();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
      title={t.app.demoFundsNote}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--taply-lime)]" />
      {t.app.networkBadge}
    </span>
  );
}

/** Short account ID when connected; links to Settings where it can be managed. */
function WalletStatus() {
  const t = useT();
  const { state } = useWallet();
  if (state.status !== 'connected') return null;

  const { accountId } = state.session;
  return (
    <Link
      href="/settings"
      className="tap-target hidden items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3 text-xs font-medium min-[380px]:inline-flex"
      aria-label={`${t.wallet.accountMenuLabel}: ${accountId}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--taply-lime)]" />
      <span className="chain-id max-w-[7.5rem] truncate text-xs" aria-hidden="true">
        {shortAccountId(accountId)}
      </span>
    </Link>
  );
}

function OfflineBanner() {
  const t = useT();
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="mx-4 mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] p-3 text-sm text-[var(--tone-caution-fg)]"
    >
      <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
      <span>
        <strong className="font-semibold">{t.notices.offline.title}.</strong>{' '}
        <span className="text-[var(--text-secondary)]">{t.notices.offline.body}</span>
      </span>
    </div>
  );
}

export function LocaleSwitch() {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <fieldset>
      <legend className="sr-only">{t.app.languageLabel}</legend>
      <div className="grid grid-cols-2 gap-2">
        {LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={locale === code}
            onClick={() => {
              if (code !== locale) setLocale(code as Locale);
            }}
            className={`tap-target rounded-[var(--radius-control)] border px-3 text-sm font-medium ${
              locale === code
                ? 'border-[var(--taply-lime)] bg-[var(--tone-success-bg)] text-[var(--taply-lime)]'
                : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
            }`}
          >
            {DICTIONARIES[code].localeName}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function BottomNav() {
  const t = useT();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t.nav.primaryLabel}
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[480px] border-t border-[var(--border-subtle)] bg-[rgb(17_28_21/0.94)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="flex items-stretch justify-around px-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  active ? 'text-[var(--taply-lime)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span
                  className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${
                    active ? 'bg-[var(--tone-success-bg)]' : ''
                  }`}
                >
                  <Icon name={item.icon} size={22} />
                </span>
                {t.nav[item.labelKey]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
