import type { ReactNode } from 'react';
import { MainnetShell } from '@/components/mainnet/MainnetShell';
import { MainnetLocaleProvider } from '@/lib/mainnet/copy';
import { I18nProvider } from '@/lib/i18n/provider';
import { MAINNET_DICTIONARIES } from '@/lib/i18n/mainnet-dictionaries';
import { MainnetWalletProvider } from '@/lib/mainnet/wallet';
import type { Locale } from '@/lib/i18n/types';

/**
 * The NEAR Mainnet body. It renders the shared Taply presentation (shell, wallet home,
 * scanner, tickets) with the product dictionaries adapted to Mainnet wording
 * (lib/i18n/mainnet-dictionaries). No Testnet wallet adapter, vault, payments or
 * signing module is imported: Mainnet data and actions come from lib/mainnet only.
 */
export function Root({ locale, children }: { readonly locale: Locale; readonly children: ReactNode }) {
  return (
    <>
      <I18nProvider locale={locale} dictionaries={MAINNET_DICTIONARIES}>
        <MainnetLocaleProvider locale={locale}>
          <MainnetWalletProvider>
            <MainnetShell>{children}</MainnetShell>
          </MainnetWalletProvider>
        </MainnetLocaleProvider>
      </I18nProvider>
      <span className="sr-only">NEAR Mainnet build. Real funds. Unaudited candidate contract, capped.</span>
    </>
  );
}
