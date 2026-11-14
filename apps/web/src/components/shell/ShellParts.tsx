'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { Icon } from '@/components/shell/Icons';
import type { IconName } from '@/components/shell/Icons';
import { PayChoices, PayLinkForm } from '@/components/scan/PayEntry';
import { QrScanner } from '@/components/scan/QrScanner';
import { Sheet, SheetAction } from '@/components/shell/Sheet';
import { useOnline } from '@/lib/hooks/browser';
import { useLocale, useT } from '@/lib/i18n/provider';
import { LOCALES, DICTIONARIES } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import type { ScanInput } from '@/lib/payments/pay-link';

/**
 * The Taply shell (docs/UX_ONE_TAP_REDESIGN.md), shared by the Testnet and NEAR
 * Mainnet builds. Presentation and navigation only: no wallet provider, network
 * client or transaction code. Each build passes its routes, its account menu and,
 * for Mainnet, its own link parser.
 */
export interface ShellRoutes {
  readonly home: string;
  readonly activity: string;
  readonly request: string;
  readonly send: string;
  readonly protectedNew: string | null;
  readonly giftNew: string | null;
  readonly pay: (id: string) => string;
  readonly checkout: (accountId: string) => string;
  /** Network-specific scan/paste parser; omitted = the Testnet parser. */
  readonly parse?: (text: string) => ScanInput;
}

export function ShellFrame({ routes, accountMenu, notice, children }: { readonly routes: ShellRoutes; readonly accountMenu: ReactNode; readonly notice?: ReactNode; readonly children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col lg:max-w-[560px]">
      <a href="#main" className="sr-only-focusable m-2 rounded bg-[var(--surface-2)] p-2 text-sm">
        {t.app.skipToContent}
      </a>

      <TopBar home={routes.home} accountMenu={accountMenu} notice={notice} />
      <OfflineBanner />

      <main id="main" className="flex-1 px-4 pt-3 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-5">
        {/* Keyed by route so each tab change gets a short fade-in. */}
        <div key={pathname} className="animate-page">
          {children}
        </div>
      </main>

      <BottomNav routes={routes} />
    </div>
  );
}

function TopBar({ home, accountMenu, notice }: { readonly home: string; readonly accountMenu: ReactNode; readonly notice?: ReactNode }) {
  const t = useT();

  return (
    <header className="sticky top-0 z-20 bg-[rgb(11_18_14/0.86)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-5">
        <Link href={home as Route} aria-label={t.app.name} className="tap-target -ml-1 flex items-center px-1">
          <TaplyWordmark width={76} />
        </Link>
        <div className="flex items-center gap-2">
          <NetworkBadge />
          {accountMenu}
        </div>
      </div>
      {notice}
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
      data-testid="network-pill"
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]"
      title={t.app.demoFundsNote}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--taply-lime)]" />
      {t.app.networkBadge}
    </span>
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

function BottomNav({ routes }: { readonly routes: ShellRoutes }) {
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
          <NavLink href={routes.home} icon="wallet" label={t.oneTap.nav.wallet} active={pathname === routes.home || (routes.home !== '/' && pathname.startsWith(`${routes.home}/wallet`))} />
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
          <NavLink href={routes.activity} icon="activity" label={t.oneTap.nav.activity} active={pathname.startsWith(routes.activity)} />
        </li>
      </ul>
      <TapSheet
        routes={routes}
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
            router.push(routes.pay(id) as Route);
          }}
          onMerchant={(accountId) => {
            setScanning(false);
            router.push(routes.checkout(accountId) as Route);
          }}
          {...(routes.parse ? { parse: routes.parse } : {})}
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
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly active: boolean;
}) {
  return (
    <Link
      href={href as Route}
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
  routes,
  open,
  view,
  onView,
  onClose,
  onScan,
}: {
  readonly routes: ShellRoutes;
  readonly open: boolean;
  readonly view: TapView;
  readonly onView: (view: TapView) => void;
  readonly onClose: () => void;
  readonly onScan: () => void;
}) {
  const t = useT();
  const s = t.oneTap.sheet;
  const router = useRouter();

  const go = (href: string) => {
    onClose();
    router.push(href as Route);
  };
  const title = view === 'menu' ? s.title : view === 'pay' ? t.oneTap.payEntry.title : t.oneTap.payLink.title;
  const description = view === 'menu' ? s.description : view === 'pay' ? t.oneTap.payEntry.body : t.oneTap.payLink.body;

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} closeLabel={s.close}>
      {view === 'menu' && (
        <div className="flex flex-col gap-1">
          <SheetAction index={0} primary icon={<Icon name="request" size={22} />} label={s.request.label} body={s.request.body} onSelect={() => go(routes.request)} />
          <SheetAction index={1} icon={<Icon name="scan" size={22} />} label={s.pay.label} body={s.pay.body} onSelect={() => onView('pay')} />
          <SheetAction index={2} icon={<Icon name="send" size={22} />} label={s.send.label} body={s.send.body} onSelect={() => go(routes.send)} />
          {routes.protectedNew !== null && (
            <SheetAction index={3} icon={<Icon name="shield" size={22} />} label={t.protectedFlow.newTitle} body={t.protectedFlow.sheetBody} onSelect={() => go(routes.protectedNew ?? '')} />
          )}
          {routes.giftNew !== null && (
            <SheetAction index={4} icon={<Icon name="gift" size={22} />} label={t.gift.sheet.label} body={t.gift.sheet.body} onSelect={() => go(routes.giftNew ?? '')} />
          )}
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
            router.push(routes.pay(id) as Route);
          }}
          onMerchant={(accountId) => {
            onClose();
            router.push(routes.checkout(accountId) as Route);
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
