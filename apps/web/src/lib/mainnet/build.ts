/**
 * Build-time network selection (docs/MAINNET_BRIEF.md §2.4, docs/MAINNET.md).
 *
 * `NEXT_PUBLIC_TAPLY_NETWORK` is inlined by Next.js at build time, so in a
 * Testnet build this constant is `false` and every mainnet branch is dead code.
 * There is no runtime selector and no cross-network fallback.
 */
import { isProductRoute } from './product';
export const IS_MAINNET_BUILD: boolean = process.env.NEXT_PUBLIC_TAPLY_NETWORK === 'near-mainnet';

/** Path prefixes that exist only in a mainnet build. */
export const MAINNET_PAGE_PREFIX = '/m';
export const MAINNET_API_PREFIX = '/api/mainnet';

/** Matches no route, so Next renders its standard not-found page with 404. */
export const UNMATCHED_PATH = '/__taply_unmatched__';

export type RouteDecision =
  | { readonly kind: 'pass' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'rewrite_not_found' }
  | { readonly kind: 'redirect'; readonly location: string };

const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Route isolation between the two builds.
 *
 *  - Testnet build: mainnet paths are rewritten to an unmatched internal path,
 *    so Next serves exactly the 404 page (status 404) it served before these
 *    routes existed. Every other path passes untouched.
 *  - Mainnet build: only the mainnet surface is served. Product paths redirect
 *    to their isolated Mainnet counterparts; other legacy paths go home and
 *    Testnet APIs answer 404. A Testnet mnemonic vault can
 *    therefore never be opened on the mainnet host.
 */
export function routeDecision(pathname: string, mainnet: boolean): RouteDecision {
  const mainnetPath = isUnder(pathname, MAINNET_PAGE_PREFIX) || isUnder(pathname, MAINNET_API_PREFIX);
  if (!mainnet) return mainnetPath ? { kind: 'rewrite_not_found' } : { kind: 'pass' };
  if (isUnder(pathname, MAINNET_PAGE_PREFIX) && pathname !== MAINNET_PAGE_PREFIX) {
    const path = pathname.slice(MAINNET_PAGE_PREFIX.length + 1);
    if (!isProductRoute(path) && path !== 'request/new' && path !== 'manifest.webmanifest' && !/^pay\/[0-9a-f]{64}$/.test(path)) return { kind: 'not_found' };
  }
  if (mainnetPath) return { kind: 'pass' };
  if (pathname.startsWith('/api/')) return { kind: 'not_found' };
  const path = pathname.slice(1);
  if (isProductRoute(path) || path === 'request/new' || /^pay\/[0-9a-f]{64}$/.test(path))
    return { kind: 'redirect', location: `${MAINNET_PAGE_PREFIX}/${path}` };
  return { kind: 'redirect', location: MAINNET_PAGE_PREFIX };
}
