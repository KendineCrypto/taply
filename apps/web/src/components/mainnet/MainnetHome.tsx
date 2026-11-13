'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/primitives/Button';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { assetById, formatMainnetAmount } from '@/lib/mainnet/assets';
import { MAINNET_CONFIG } from '@/lib/mainnet/config';
import { fixtureRequests } from '@/lib/mainnet/fixtures';
import { Notice, short } from './bits';
import { WalletPanel } from './WalletPanel';
import { fill, useMainnetCopy, useMainnetLocale as useLocale } from '@/lib/mainnet/copy';

/** Accepts a bare 64-hex id or a Taply mainnet pay link on the same origin path. */
export function parsePayInput(text: string): string | null {
  const value = text.trim();
  if (/^[0-9a-f]{64}$/.test(value)) return value;
  const match = /^https:\/\/[^/\s]+\/m\/pay\/([0-9a-f]{64})\/?$/.exec(value);
  return match?.[1] ?? null;
}

export function MainnetHome() {
  const c = useMainnetCopy();
  const { locale } = useLocale();
  const router = useRouter();
  const [payInput, setPayInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [fixtures] = useState(() => (MAINNET_CONFIG.ok && MAINNET_CONFIG.fixtures ? fixtureRequests(Date.now()) : []));

  if (!MAINNET_CONFIG.ok) return <Notice tone="danger">{c.home.configBroken}</Notice>;
  const contract = MAINNET_CONFIG.contract;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader title={c.home.title} description={c.home.lead} />

      <Card>
        <h2 className="text-[15px] font-semibold">{c.home.merchantCta}</h2>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">{c.home.merchantHint}</p>
        <div className="mt-3">
          <ButtonLink href="/m/request/new" variant="primary" block>{c.home.merchantCta}</ButtonLink>
        </div>
      </Card>

      <Card>
        <h2 className="text-[15px] font-semibold">{c.home.payCta}</h2>
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const id = parsePayInput(payInput);
            setInvalid(id === null);
            if (id !== null) router.push(`/m/pay/${id}` as Route);
          }}
        >
          <label htmlFor="pay-input" className="text-[13px] text-[var(--text-secondary)]">{c.home.payHint}</label>
          <input
            id="pay-input"
            value={payInput}
            onChange={(e) => setPayInput(e.target.value)}
            placeholder={c.home.payPlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid}
            className="min-h-[var(--tap-target)] rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-0)] px-3 font-mono text-[13px]"
          />
          {invalid && <p role="alert" className="text-[13px] text-[var(--tone-danger-fg)]">{c.home.payInvalid}</p>}
          <Button type="submit" variant="secondary">{c.home.payOpen}</Button>
        </form>
      </Card>

      <Card>
        <WalletPanel />
      </Card>

      <Card>
        <h2 className="text-[15px] font-semibold">{c.home.contractTitle}</h2>
        <p data-testid="contract-status" className="mt-1 break-all text-[13px] text-[var(--text-secondary)]">
          {contract.status === 'configured'
            ? fill(c.home.contractConfigured, { account: contract.accountId, hash: short(contract.expectedCodeHash) })
            : contract.status === 'invalid'
              ? c.home.contractInvalid
              : c.home.contractNotConfigured}
        </p>
      </Card>

      {fixtures.length > 0 && (
        <Card>
          <h2 className="text-[15px] font-semibold">{c.home.fixturesTitle}</h2>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">{c.home.fixturesHint}</p>
          <ul className="mt-3 flex flex-col gap-1.5" data-testid="fixture-list">
            {fixtures.map(({ scenario, request }) => {
              const asset = assetById(request.terms.assetId)!;
              return (
                <li key={scenario.name}>
                  <Link
                    href={`/m/pay/${request.terms.id}` as Route}
                    className="pressable flex min-h-[var(--tap-target)] items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3 py-2 text-[13px]"
                  >
                    <span className="font-mono">{scenario.name}</span>
                    <span className="text-[var(--text-secondary)]">{formatMainnetAmount(request.terms.amountBaseUnits, asset, locale)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
