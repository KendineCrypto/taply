import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { AppShell } from '@/components/shell/AppShell';
import { I18nProvider } from '@/lib/i18n/provider';
import { WalletProvider } from '@/lib/wallet/provider';
import { PaymentsProvider } from '@/lib/payments/context';
import { LOCALE_COOKIE, getDictionary, resolveLocale } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Taply — NEAR Testnet payments',
  description:
    'Mobile-first NEAR Testnet wallet and merchant payment app with explicit settlement states. Test funds only.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Taply',
  icons: {
    icon: [
      { url: '/brand/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: { capable: true, title: 'Taply', statusBarStyle: 'black-translucent' },
  // Payment surfaces must never be indexed or previewed by third parties.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays available: disabling it is an accessibility regression.
  maximumScale: 5,
  // Lets content use the full screen on notched devices; the shell pads with
  // env(safe-area-inset-*) so nothing sits under the notch or home indicator.
  viewportFit: 'cover',
  themeColor: '#0B120E',
};

export default async function RootLayout({ children }: { readonly children: React.ReactNode }) {
  // Resolving the locale on the server means the first paint is already correct,
  // so status copy never flashes in the wrong language.
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get('accept-language'),
  );
  const dictionary = getDictionary(locale);

  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          <WalletProvider>
            <PaymentsProvider>
              <AppShell>{children}</AppShell>
            </PaymentsProvider>
          </WalletProvider>
        </I18nProvider>
        {/* Static, honest statement of what this build is. */}
        <span className="sr-only">{dictionary.app.demoFundsNote}</span>
      </body>
    </html>
  );
}
