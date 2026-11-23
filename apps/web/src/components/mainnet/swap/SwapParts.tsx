'use client';

import { useId, useState } from 'react';
import { Icon } from '@/components/shell/Icons';
import { Sheet } from '@/components/shell/Sheet';
import { formatBaseUnits } from '@/lib/format/amount';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { InvalidAmountError, toBaseUnits } from '@/lib/format/amount';
import { MAINNET_SWAP_LIMITS } from '@taply/near-client';
import { searchSwapAssets, type SwapAsset, type SwapAssetId } from '@/lib/mainnet/swap/model';
import type { SwapCopy } from '@/lib/mainnet/swap/copy';
import type { Locale } from '@/lib/i18n/types';

/** Exact amount text, never rounded up. `max` limits shown fraction digits (truncated toward zero). */
export function fmt(baseUnits: bigint | string, asset: SwapAsset, locale: Locale, max?: number): string {
  const f = formatBaseUnits(baseUnits.toString(), asset.decimals, { locale, maxFractionDigits: max ?? asset.decimals });
  return `${max === undefined ? f.exact : f.display} ${asset.symbol}`;
}
export function pct(bps: number, locale: Locale): string {
  const whole = Math.floor(bps / 100), frac = String(bps % 100).padStart(2, '0');
  return locale === 'tr' ? `%${whole},${frac}` : `${whole}.${frac}%`;
}
export function txUrl(hash: string): string {
  return `${MAINNET_CONFIG.ok ? MAINNET_CONFIG.explorerBaseUrl : 'https://nearblocks.io'}/txns/${hash}`;
}

/** Token mark: palette-only monogram (no third-party logo files). */
export function TokenMark({ asset, size = 28 }: { readonly asset: SwapAsset; readonly size?: number }) {
  const style = asset.id === 'near' ? 'bg-[var(--taply-cream)] text-[var(--taply-night)]'
    : asset.id === 'wnear' ? 'bg-[var(--taply-olive)] text-[var(--taply-cream)] ring-1 ring-[var(--taply-cream)]/40'
    : 'bg-[var(--surface-2)] text-[var(--taply-lime)] ring-1 ring-[var(--taply-lime)]/40';
  const glyph = asset.id === 'near' ? 'N' : asset.id === 'wnear' ? 'wN' : '$';
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full font-bold ${style}`} style={{ width: size, height: size, fontSize: glyph.length > 1 ? `${size * 0.36}px` : `${size * 0.46}px` }}>
      {glyph}
    </span>
  );
}

export function NetworkBadge({ label }: { readonly label: string }) {
  return <span className="rounded-full border border-[var(--border-strong)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>;
}

export function TokenButton({ asset, onClick, label, c }: { readonly asset: SwapAsset; readonly onClick: () => void; readonly label: string; readonly c: SwapCopy }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${label}: ${asset.symbol} (${c.network})`} data-testid={`token-${asset.id}`}
      className="pressable flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] py-1 pl-1.5 pr-2.5 hover:border-[var(--border-strong)]">
      <TokenMark asset={asset} />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[15px] font-semibold">{asset.symbol}</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">{c.network}</span>
      </span>
      <Icon name="chevron" size={14} className="rotate-90 text-[var(--text-muted)]" />
    </button>
  );
}

/** Verified-list token sheet with search (symbol, name or contract). Plain text only. */
export function TokenSheet({ open, onClose, onPick, selected, other, balances, locale, c }: {
  readonly open: boolean; readonly onClose: () => void; readonly onPick: (id: SwapAssetId) => void;
  readonly selected: SwapAssetId; readonly other: SwapAssetId; readonly balances: Partial<Record<SwapAssetId, bigint>>; readonly locale: Locale; readonly c: SwapCopy;
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  const list = searchSwapAssets(query);
  return (
    <Sheet open={open} onClose={() => { setQuery(''); onClose(); }} title={c.selectToken} closeLabel={c.close}>
      <label htmlFor={`${id}-q`} className="sr-only">{c.searchToken}</label>
      <input id={`${id}-q`} value={query} onChange={e => setQuery(e.target.value.slice(0, 80))} placeholder={c.searchToken} autoComplete="off" spellCheck={false}
        className="mb-3 min-h-11 w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 text-[15px]" data-testid="token-search" />
      <ul className="flex flex-col gap-1" data-testid="token-list">
        {list.map(a => {
          const b = balances[a.id];
          return (
            <li key={a.id}>
              <button type="button" onClick={() => { setQuery(''); onPick(a.id); }} aria-pressed={a.id === selected} data-testid={`pick-${a.id}`}
                className={`flex min-h-[56px] w-full items-center gap-3 rounded-[var(--radius-control)] px-2 text-left hover:bg-[var(--tone-neutral-bg)] ${a.id === selected ? 'bg-[var(--tone-neutral-bg)]' : ''}`}>
                <TokenMark asset={a} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5"><span className="font-semibold">{a.symbol}</span><NetworkBadge label={c.network} />{a.id === other && <span className="sr-only">(selected on the other side)</span>}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">{a.name} · {a.contract === null ? c.native : <span className="font-mono">{a.contract.length > 24 ? `${a.contract.slice(0, 10)}…${a.contract.slice(-6)}` : a.contract}</span>}</span>
                </span>
                {b !== undefined && <span className="shrink-0 text-right text-sm tabular-nums text-[var(--text-secondary)]">{fmt(b, a, locale, a.decimals === 6 ? 2 : 4).split(' ')[0]}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && <p className="py-4 text-center text-sm text-[var(--text-secondary)]" role="status">{c.noTokenMatch}</p>}
      <p className="mt-3 text-xs text-[var(--text-muted)]">{c.verifiedOnly}</p>
    </Sheet>
  );
}

export const SLIPPAGE_PRESETS = [10, 50, 100] as const;
/** "0.5" / "0,5" percent -> basis points (integer, exact), or null. */
export function parseSlippage(text: string): number | null {
  try {
    // Hundredths of a percent = basis points (an exact integer string, at most 3 digits here).
    const units = toBaseUnits(text.trim(), 2);
    if (BigInt(units) < 1n || BigInt(units) > BigInt(MAINNET_SWAP_LIMITS.maxSlippageBps)) return null;
    return Number.parseInt(units, 10);
  } catch (e) { if (e instanceof InvalidAmountError) return null; throw e; }
}

export function SettingsSheet({ open, onClose, slippageBps, onSlippage, locale, c }: {
  readonly open: boolean; readonly onClose: () => void; readonly slippageBps: number; readonly onSlippage: (bps: number) => void; readonly locale: Locale; readonly c: SwapCopy;
}) {
  const preset = (SLIPPAGE_PRESETS as readonly number[]).includes(slippageBps);
  const [custom, setCustom] = useState(preset ? '' : pct(slippageBps, locale).replace(/[%]/g, ''));
  const id = useId();
  const parsed = custom === '' ? null : parseSlippage(custom);
  return (
    <Sheet open={open} onClose={onClose} title={c.settings} closeLabel={c.close}>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">{c.slippage}</legend>
        <p className="mb-3 text-[13px] text-[var(--text-secondary)]">{c.slippageHelp}</p>
        <div className="grid grid-cols-4 gap-2">
          {SLIPPAGE_PRESETS.map(bps => (
            <button key={bps} type="button" aria-pressed={slippageBps === bps} onClick={() => { setCustom(''); onSlippage(bps); }} data-testid={`slippage-${bps}`}
              className={`tap-target rounded-[var(--radius-control)] border text-sm font-semibold ${slippageBps === bps ? 'border-[var(--taply-lime)] text-[var(--taply-lime)]' : 'border-[var(--border-strong)] text-[var(--text-secondary)]'}`}>
              {pct(bps, locale).replace(/,00|\.00/, '')}
            </button>
          ))}
          <label className="relative">
            <span className="sr-only">{c.custom}</span>
            <input id={`${id}-custom`} inputMode="decimal" value={custom} placeholder={c.custom} aria-invalid={custom !== '' && parsed === null}
              onChange={e => { const v = e.target.value.slice(0, 6); setCustom(v); const p = parseSlippage(v); if (p !== null) onSlippage(p); }}
              className={`tap-target w-full rounded-[var(--radius-control)] border bg-[var(--surface-0)] px-2 pr-6 text-right text-sm ${!preset ? 'border-[var(--taply-lime)]' : 'border-[var(--border-strong)]'}`} data-testid="slippage-custom" />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">%</span>
          </label>
        </div>
        {custom !== '' && parsed === null && <p className="mt-2 text-[13px] text-[var(--tone-danger-fg)]" role="alert">{c.slippageInvalid}</p>}
        {slippageBps > MAINNET_SWAP_LIMITS.highSlippageBps && <p className="mt-2 text-[13px] text-[var(--tone-caution-fg)]" role="status" data-testid="slippage-high">{c.slippageHigh}</p>}
      </fieldset>
    </Sheet>
  );
}

export function DetailLine({ label, children, note, testId }: { readonly label: string; readonly children: React.ReactNode; readonly note?: string; readonly testId?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className="text-[13px] text-[var(--text-secondary)]">{label}{note && <span className="block text-[11px] text-[var(--text-muted)]">{note}</span>}</dt>
      <dd className="min-w-0 break-words text-right text-[13px] font-medium tabular-nums" data-testid={testId}>{children}</dd>
    </div>
  );
}

export function StepIcon({ status }: { readonly status: string }) {
  if (status === 'done') return <span className="grid size-6 place-items-center rounded-full bg-[var(--taply-lime)] text-[var(--taply-night)]"><Icon name="check" size={14} /></span>;
  if (status === 'signing') return <span className="size-6 animate-spin rounded-full border-2 border-[var(--taply-lime)] border-t-transparent motion-reduce:animate-none" />;
  if (status === 'unknown' || status === 'not_delivered') return <span className="grid size-6 place-items-center rounded-full bg-[var(--tone-caution-bg)] text-[var(--tone-caution-fg)]"><Icon name="alert" size={14} /></span>;
  if (status === 'failed' || status === 'refunded') return <span className="grid size-6 place-items-center rounded-full bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]"><Icon name="x" size={14} /></span>;
  return <span className="size-6 rounded-full border-2 border-[var(--border-strong)]" />;
}
