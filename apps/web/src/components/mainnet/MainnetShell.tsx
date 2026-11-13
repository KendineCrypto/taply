'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { TaplyWordmark } from '@/components/brand/TaplyIcon';
import { useOnline } from '@/lib/hooks/browser';
import { LOCALES } from '@/lib/i18n/types';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { ProductNav } from './MainnetProduct';
import { useMainnetCopy, useMainnetLocale as useLocale } from '@/lib/mainnet/copy';

/**
 * Shell for the NEAR Mainnet build. The network pill and the real-funds /
 * unaudited / capped / NO-GO banner are on every screen. No Testnet provider
 * (Testnet wallet adapter, mnemonic vault, Testnet payments) is mounted here.
 */
export function MainnetShell({ children }: { readonly children: ReactNode }) {
  const c = useMainnetCopy();
  const online = useOnline();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col lg:max-w-[560px]">
      <a href="#main" className="sr-only-focusable m-2 rounded bg-[var(--surface-2)] p-2 text-sm">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 bg-[rgb(11_18_14/0.9)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-5">
          <Link href="/m" aria-label="Taply" className="tap-target -ml-1 flex items-center px-1">
            <TaplyWordmark width={76} />
          </Link>
          <div className="flex items-center gap-2">
            <MainnetPill />
            <LocaleToggle />
          </div>
        </div>
        <div role="note" className="border-y border-[var(--tone-caution-border)] bg-[var(--tone-caution-bg)] px-4 py-2 text-[12px] leading-snug text-[var(--tone-caution-fg)] sm:px-5">
          <p className="font-semibold">{c.network.banner}</p>
          <p className="text-[var(--text-secondary)]">{c.network.capLine} {c.network.noGo}</p>
        </div>
        {MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures && (
          <p role="note" data-testid="fixture-banner" className="bg-[var(--surface-2)] px-4 py-1.5 text-center text-[12px] font-semibold tracking-wide text-[var(--taply-cream)] sm:px-5">
            {c.network.fixtureBanner}
          </p>
        )}
        {!online && (
          <p role="status" className="bg-[var(--tone-danger-bg)] px-4 py-1.5 text-center text-[12px] text-[var(--tone-danger-fg)]">
            Offline
          </p>
        )}
      </header>
      <main id="main" className="flex-1 px-4 pt-4 pb-[calc(3rem+env(safe-area-inset-bottom))] sm:px-5">
        {children}
      </main>
      <ProductNav />
    </div>
  );
}

export function MainnetPill() {
  const c = useMainnetCopy();
  return (
    <span
      data-testid="network-pill"
      aria-label={c.network.pillAria}
      title={c.network.pillAria}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--tone-caution-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--tone-caution-fg)]"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--taply-gold)]" />
      {c.network.pill}
    </span>
  );
}

function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  const next = LOCALES.find((l) => l !== locale) ?? locale;
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      className="pressable tap-target rounded-full px-2 text-[12px] font-semibold uppercase text-[var(--text-secondary)]"
      aria-label={next === 'tr' ? 'Türkçe' : 'English'}
    >
      {next}
    </button>
  );
}
