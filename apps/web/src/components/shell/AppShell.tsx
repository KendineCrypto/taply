'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { Monogram } from '@/components/experience/Basics';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { PayChoices, PayLinkForm } from '@/components/scan/PayEntry';
import { QrScanner } from '@/components/scan/QrScanner';
import { Sheet, SheetAction } from '@/components/shell/Sheet';
import { WalletKindBadge } from '@/components/wallet/WalletKind';
import { useWalletMode } from '@/components/wallet/taply/mode';
import { useOnline } from '@/lib/hooks/browser';
import { useLocale, useT } from '@/lib/i18n/provider';
import { LOCALES, DICTIONARIES } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import { useWallet } from '@/lib/wallet/provider';

/**
 * Mobile-first shell (docs/UX_ONE_TAP_REDESIGN.md).
 *
 * Three persistent destinations only: Wallet, Tap (opens a sheet) and
 * Activity. Settings, wallet management, receive, language and help live in
 * the account menu (top right). The NEAR Testnet badge is always visible.
 * Targets are >= 44px, there is a skip link, one <main> landmark and
 * safe-area insets for notched devices.
 */

export function AppShell({ children }: { readonly children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col lg:max-w-[560px]">
      <a href="#main" className="sr-only-focusable m-2 rounded bg-[var(--surface-2)] p-2 text-sm">
        {t.app.skipToContent}
      </a>

      <TopBar />
      <OfflineBanner />

      <main id="main" className="flex-1 px-4 pt-3 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-5">
        {/* Keyed by route so each tab change gets a short fade-in. */}
        <div key={pathname} className="animate-page">
          {children}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}

function TopBar() {
  const t = useT();

  return (
    <header className="sticky top-0 z-20 bg-[rgb(11_18_14/0.86)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-5">
        <Link href="/" aria-label={t.app.name} className="tap-target -ml-1 flex items-center px-1">
          <TaplyWordmark width={76} />
        </Link>
        <div className="flex items-center gap-2">
          <NetworkBadge />
          <AccountMenu />
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

interface MenuLink {
  readonly href: '/wallet' | '/receive' | '/merchant' | '/settings' | '/demo';
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<TapView>('menu');
  const [scanning, setScanning] = useState(false);

  return (
    <nav
      aria-label={t.nav.primaryLabel}
      className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[480px] border-t border-[var(--border-subtle)] bg-[rgb(17_28_21/0.94)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:bottom-5 lg:max-w-[360px] lg:rounded-full lg:border lg:pb-0 lg:shadow-[var(--shadow-float)]"
    >
      <ul className="grid grid-cols-3 items-end px-2">
        <li>
          <NavLink href="/" icon="wallet" label={t.oneTap.nav.wallet} active={pathname === '/'} />
        </li>
        <li className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              setView('menu');
              setOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="pressable group -mt-5 flex flex-col items-center gap-1 pb-2 text-[11px] font-semibold text-[var(--text-primary)] lg:-mt-4"
          >
            <span className="grid size-[58px] place-items-center rounded-full bg-[var(--taply-lime)] text-[var(--taply-night)] shadow-[0_12px_28px_-10px_rgb(199_252_117/0.6)] ring-4 ring-[var(--surface-0)] transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
              <TapGlyph />
            </span>
            {t.oneTap.nav.tap}
          </button>
        </li>
        <li>
          <NavLink href="/activity" icon="activity" label={t.oneTap.nav.activity} active={pathname.startsWith('/activity')} />
        </li>
      </ul>
      <TapSheet
        open={open}
        view={view}
        onView={setView}
        onClose={() => setOpen(false)}
        onScan={() => {
          // The camera is requested only now, by an explicit choice.
          setOpen(false);
          setScanning(true);
        }}
      />
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onRequest={(id) => {
            setScanning(false);
            router.push(`/pay/${id}`);
          }}
          onPasteLink={() => {
            setScanning(false);
            setView('link');
            setOpen(true);
          }}
        />
      )}
    </nav>
  );
}

function NavLink({
  href,
  icon,
  label,
  active,
}: {
  readonly href: '/' | '/activity';
  readonly icon: IconName;
  readonly label: string;
  readonly active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-[62px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-200 ${
        active ? 'text-[var(--taply-lime)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span
        className={`grid h-7 w-12 place-items-center rounded-full transition-[background-color,transform] duration-200 ${
          active ? 'scale-100 bg-[var(--tone-success-bg)]' : 'scale-95'
        }`}
      >
        <Icon name={icon} size={22} />
      </span>
      {label}
    </Link>
  );
}

/** Two concentric arcs: a tap ripple. Generic glyph, not the Taply mark. */
function TapGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9" />
      <path d="M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" opacity="0.55" />
    </svg>
  );
}

type TapView = 'menu' | 'pay' | 'link';

/** The Tap sheet: Request (primary), Pay (link or QR), Send (honestly labelled preview). */
function TapSheet({
  open,
  view,
  onView,
  onClose,
  onScan,
}: {
  readonly open: boolean;
  readonly view: TapView;
  readonly onView: (view: TapView) => void;
  readonly onClose: () => void;
  readonly onScan: () => void;
}) {
  const t = useT();
  const s = t.oneTap.sheet;
  const router = useRouter();

  const go = (href: '/request/new' | '/send') => {
    onClose();
    router.push(href);
  };
  const title = view === 'menu' ? s.title : view === 'pay' ? t.oneTap.payEntry.title : t.oneTap.payLink.title;
  const description = view === 'menu' ? s.description : view === 'pay' ? t.oneTap.payEntry.body : t.oneTap.payLink.body;

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} closeLabel={s.close}>
      {view === 'menu' && (
        <div className="flex flex-col gap-1">
          <SheetAction index={0} primary icon={<Icon name="request" size={22} />} label={s.request.label} body={s.request.body} onSelect={() => go('/request/new')} />
          <SheetAction index={1} icon={<Icon name="scan" size={22} />} label={s.pay.label} body={s.pay.body} onSelect={() => onView('pay')} />
          <SheetAction index={2} icon={<Icon name="send" size={22} />} label={s.send.label} body={s.send.body} onSelect={() => go('/send')} />
        </div>
      )}
      {view === 'pay' && (
        <div className="animate-page flex flex-col gap-3">
          <PayChoices onLink={() => onView('link')} onScan={onScan} />
          <BackButton label={t.oneTap.payLink.back} onBack={() => onView('menu')} />
        </div>
      )}
      {view === 'link' && (
        <PayLinkForm
          onBack={() => onView('pay')}
          onOpen={(id) => {
            onClose();
            router.push(`/pay/${id}`);
          }}
        />
      )}
    </Sheet>
  );
}

function BackButton({ label, onBack }: { readonly label: string; readonly onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="tap-target inline-flex items-center justify-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
    >
      <Icon name="arrow-left" size={16} />
      {label}
    </button>
  );
}
