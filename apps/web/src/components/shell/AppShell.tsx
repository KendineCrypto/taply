'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { useLocale, useT } from '@/lib/i18n/provider';
import { LOCALES, DICTIONARIES } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';

/**
 * Mobile-first shell. Target widths 360 / 390 / 430px with a desktop-responsive
 * centred column (CLAUDE.md, UX_FLOWS.md).
 *
 * Chrome requirements met here: wordmark, persistent NEAR Testnet badge, bottom
 * navigation with >= 44px targets, a skip link, and a single <main> landmark.
 */

interface NavItem {
  readonly href: '/' | '/pay' | '/scan' | '/activity' | '/settings';
  readonly labelKey: 'home' | 'pay' | 'scan' | 'activity' | 'settings';
  readonly glyph: string;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { href: '/', labelKey: 'home', glyph: '⌂' },
  { href: '/pay', labelKey: 'pay', glyph: '→' },
  { href: '/scan', labelKey: 'scan', glyph: '⧉' },
  { href: '/activity', labelKey: 'activity', glyph: '≡' },
  { href: '/settings', labelKey: 'settings', glyph: '⚙' },
];

export function AppShell({ children }: { readonly children: ReactNode }) {
  const t = useT();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-sm flex-col">
      <a href="#main" className="sr-only-focusable m-2 rounded bg-[var(--surface-2)] p-2 text-sm">
        {t.app.skipToContent}
      </a>

      <TopBar />

      <main id="main" className="flex-1 px-4 pb-28 pt-2">
        {children}
      </main>

      <BottomNav />
    </div>
  );
}

function TopBar() {
  const t = useT();

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-0)]/95 px-4 py-3 backdrop-blur">
      <Link href="/" aria-label={t.app.name} className="flex items-center">
        <TaplyWordmark width={88} />
      </Link>
      <div className="flex items-center gap-2">
        <NetworkBadge />
        <LocaleSwitch />
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
      className="rounded-full border border-[var(--border-strong)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
      title={t.app.demoFundsNote}
    >
      {t.app.networkBadge}
    </span>
  );
}

function LocaleSwitch() {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <label className="flex items-center">
      <span className="sr-only">{t.app.languageLabel}</span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="tap-target rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--surface-1)] px-2 text-xs text-[var(--text-primary)]"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {DICTIONARIES[code].localeName}
          </option>
        ))}
      </select>
    </label>
  );
}

function BottomNav() {
  const t = useT();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t.nav.primaryLabel}
      className="fixed bottom-0 left-1/2 z-10 w-full max-w-screen-sm -translate-x-1/2 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex items-stretch justify-around">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`tap-target flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${
                  active ? 'text-[var(--taply-lime)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {item.glyph}
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
