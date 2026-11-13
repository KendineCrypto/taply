import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n';
// Build-selected by next.config.ts (`@taply-root/*` alias): src/app/_roots/testnet
// or src/app/_roots/mainnet. Only one of them is ever in the module graph, so a
// mainnet bundle carries no Testnet provider and a Testnet bundle no mainnet shell.
import { Root } from '@taply-root/root';

// Self-hosted at build time by next/font (no runtime request to Google).
// latin-ext covers Turkish (ğ, ş, ı, İ).
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });

// Build-time constant (lib/mainnet/build.ts); only the metadata text depends on it here.
const MAINNET = process.env.NEXT_PUBLIC_TAPLY_NETWORK === 'near-mainnet';

export const metadata: Metadata = {
  title: MAINNET ? 'Taply — NEAR Mainnet (real funds, unaudited candidate)' : 'Taply — NEAR Testnet payments',
  description: MAINNET
    ? 'Taply on NEAR Mainnet: exact USDC and NEAR requests. Real funds, unaudited candidate contract, capped at 1 NEAR / 25 USDC per request.'
    : 'Mobile-first NEAR Testnet wallet and merchant payment app with explicit settlement states. Test funds only.',
  // Mainnet installs as its own app (name, start URL); Testnet keeps its manifest.
  manifest: MAINNET ? '/m/manifest.webmanifest' : '/manifest.webmanifest',
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
  // Only the saved choice counts; a first visit is English whatever the browser language.
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <Root locale={locale}>{children}</Root>
      </body>
    </html>
  );
}
