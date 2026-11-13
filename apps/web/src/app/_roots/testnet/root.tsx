import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { I18nProvider } from '@/lib/i18n/provider';
import { WalletProvider } from '@/lib/wallet/provider';
import { PaymentsProvider } from '@/lib/payments/context';
import { TaplyWalletProvider } from '@/components/wallet/taply/TaplyWalletProvider';
import { getDictionary } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';

/** The NEAR Testnet body, unchanged from the previous root layout. */
export function Root({ locale, children }: { readonly locale: Locale; readonly children: ReactNode }) {
  const dictionary = getDictionary(locale);
  return (
    <>
      <I18nProvider locale={locale}>
        <WalletProvider>
          <PaymentsProvider>
            <TaplyWalletProvider>
              <AppShell>{children}</AppShell>
            </TaplyWalletProvider>
          </PaymentsProvider>
        </WalletProvider>
      </I18nProvider>
      {/* Static, honest statement of what this build is. */}
      <span className="sr-only">{dictionary.app.demoFundsNote}</span>
    </>
  );
}
