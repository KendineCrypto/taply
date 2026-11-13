import type { ReactNode } from 'react';
import { MainnetShell } from '@/components/mainnet/MainnetShell';
import { MainnetLocaleProvider } from '@/lib/mainnet/copy';
import { MainnetWalletProvider } from '@/lib/mainnet/wallet';
import type { Locale } from '@/lib/i18n/types';

/**
 * The NEAR Mainnet body. None of the Testnet providers (Testnet wallet adapter,
 * Taply mnemonic vault, Testnet payments, Testnet dictionaries) is imported, so
 * none of their code ships in a mainnet bundle.
 */
export function Root({ locale, children }: { readonly locale: Locale; readonly children: ReactNode }) {
  return (
    <>
      <MainnetLocaleProvider locale={locale}>
        <MainnetWalletProvider>
          <MainnetShell>{children}</MainnetShell>
        </MainnetWalletProvider>
      </MainnetLocaleProvider>
      <span className="sr-only">NEAR Mainnet build. Real funds. Unaudited candidate contract, capped.</span>
    </>
  );
}
