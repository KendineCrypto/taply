import { z } from 'zod';
import { MainnetAccountSchema, AmountSchema, MAINNET_NATIVE_CAP, MAINNET_USDC_CAP } from '@taply/shared';
import type { ScanInput } from '@/lib/payments/pay-link';

export const PRODUCT_ROUTES = ['wallet', 'wallet/create', 'wallet/restore', 'send', 'receive', 'pay',
  'scan', 'activity', 'contacts', 'split', 'recurring', 'merchant', 'merchant/setup', 'merchant/register',
  'settings', 'protected/new', 'gift/new', 'gift/p', 'tools', 'handshake'] as const;
export function isProductRoute(path: string): boolean {
  return (PRODUCT_ROUTES as readonly string[]).includes(path) ||
    /^(receipt|protected|gift)\/[0-9a-f]{64}(\/receipt)?$/.test(path) ||
    /^gift\/[0-9a-f]{32}(\/receipt)?$/.test(path) ||
    /^s\/[A-Za-z0-9_-]{16,128}$/.test(path) ||
    (path.startsWith('checkout/') && MainnetAccountSchema.safeParse(path.slice(9)).success);
}

/** Strict same-origin Mainnet links. Never navigate to a scanned arbitrary URL. */
export function parseMainnetScan(text: string, origin: string): string | null {
  if (/^[0-9a-f]{64}$/.test(text.trim())) return `/m/pay/${text.trim()}`;
  try {
    const url = new URL(text.trim());
    const base = new URL(origin);
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    if (/^\/m\/pay\/[0-9a-f]{64}$/.test(url.pathname)) return url.pathname;
    if (url.pathname.startsWith('/m/checkout/') && isProductRoute(url.pathname.slice(3))) return url.pathname;
  } catch { /* Invalid and cross-network input stays on this screen. */ }
  return null;
}

const Contact = z.strictObject({ id: MainnetAccountSchema, label: z.string().trim().min(1).max(60) });
const Draft = z.strictObject({ id: z.string().uuid(), kind: z.enum(['recurring', 'personal', 'open']),
  recipient: z.union([MainnetAccountSchema, z.literal('')]), amount: AmountSchema,
  asset: z.enum(['NEAR', 'USDC']), note: z.string().refine(v => new TextEncoder().encode(v).length <= 280), cadence: z.enum(['weekly', 'monthly']), design: z.number().int().min(0).max(3) })
  .superRefine((draft, ctx) => {
    if (AmountSchema.safeParse(draft.amount).success && BigInt(draft.amount) > BigInt(draft.asset === 'NEAR' ? MAINNET_NATIVE_CAP : MAINNET_USDC_CAP))
      ctx.addIssue({ code: 'custom', message: 'CAP_EXCEEDED' });
    if (draft.kind !== 'open' && !MainnetAccountSchema.safeParse(draft.recipient).success)
      ctx.addIssue({ code: 'custom', message: 'RECIPIENT_REQUIRED' });
  });
const Data = z.strictObject({ contacts: z.array(Contact).max(100), drafts: z.array(Draft).max(100), requests: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(100) });
export type ProductData = z.infer<typeof Data>;
export const emptyProductData = (): ProductData => ({ contacts: [], drafts: [], requests: [] });
export function productStorageKey(owner: string): string {
  return `taply.product.near-mainnet.v1:${MainnetAccountSchema.parse(owner)}`;
}
export function loadProductData(storage: Pick<Storage, 'getItem'>, owner: string): ProductData {
  const raw = storage.getItem(productStorageKey(owner));
  if (raw === null) return emptyProductData();
  if (raw.length > 100000) throw new Error('INVALID_LOCAL_DATA');
  return Data.parse(JSON.parse(raw));
}
export function saveProductData(storage: Pick<Storage, 'setItem'>, owner: string, data: ProductData): void {
  storage.setItem(productStorageKey(owner), JSON.stringify(Data.parse(data)));
}
export function splitMainnetAmount(total: string, count: number): string[] {
  if (!/^[1-9][0-9]{0,38}$/.test(total) || !Number.isInteger(count) || count < 2 || count > 50 || BigInt(total) < BigInt(count)) throw new Error('INVALID_SPLIT');
  const n = BigInt(count); const value = BigInt(total);
  return Array.from({ length: count }, (_, i) => (value / n + (BigInt(i) < value % n ? 1n : 0n)).toString());
}

/**
 * The Testnet scanner/paste UI's ScanInput, for NEAR Mainnet links only (`/m/pay/<id>`,
 * `/m/checkout/<account>` on this origin). Testnet links and other sites are refused.
 */
export function mainnetScanInput(text: string, origin: string): ScanInput {
  const route = parseMainnetScan(text, origin);
  if (route !== null) {
    const pay = /^\/m\/pay\/([0-9a-f]{64})$/.exec(route);
    if (pay?.[1]) return { kind: 'request', id: pay[1] };
    if (route.startsWith('/m/checkout/')) return { kind: 'merchant', accountId: route.slice('/m/checkout/'.length) };
  }
  try {
    const url = new URL(text.trim());
    if (url.origin !== new URL(origin).origin) return { kind: 'other_site', host: url.host };
  } catch { /* not a URL */ }
  return { kind: 'invalid' };
}
