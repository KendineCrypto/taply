import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

/**
 * PWA manifest for the NEAR Mainnet build: its own name, id and start URL, so
 * an installed Mainnet app can never be confused with the Testnet one.
 * Same icons and colours (brand guidelines). Testnet builds never route here.
 */
export const MAINNET_MANIFEST = Object.freeze({
  name: 'Taply — NEAR Mainnet',
  short_name: 'Taply Mainnet',
  description: 'Taply on NEAR Mainnet. Real funds; unaudited candidate contract, capped at 1 NEAR / 25 USDC per request.',
  id: '/m',
  start_url: '/m',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#0B120E',
  theme_color: '#0B120E',
  lang: 'en',
  dir: 'ltr',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

export function GET(): Response {
  if (!IS_MAINNET_BUILD) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(MAINNET_MANIFEST), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } });
}
