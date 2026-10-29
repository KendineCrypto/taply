'use client';

import type { ReactNode } from 'react';
import { ScreenHeader, Card } from '@/components/primitives/Surface';
import { FeatureDisabled } from '@/components/feedback/ErrorState';
import { useT } from '@/lib/i18n/provider';
import { FLAGS } from '@/lib/flags/features';
import type { FeatureFlag } from '@/lib/flags/features';

/**
 * Honest route scaffold.
 *
 * Phase 0 establishes routing, chrome and accessibility. The payment behaviour
 * behind most of these routes does not exist yet, so each one states plainly:
 *  - what it will do;
 *  - which capability flag gates it, and why that flag is off;
 *  - what has to be proven on Testnet first.
 *
 * It renders no amounts, no accounts and no statuses, precisely so nothing here
 * can be mistaken for a working payment.
 */
export function RouteScaffold({
  title,
  description,
  flag,
  plannedBehaviour,
  dependsOn,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly flag?: FeatureFlag;
  /** Short, factual statements of intended behaviour. */
  readonly plannedBehaviour: ReadonlyArray<string>;
  /** What must land first - a Codex contract, an endpoint, a security gate. */
  readonly dependsOn?: ReadonlyArray<string>;
  readonly children?: ReactNode;
}) {
  const t = useT();

  return (
    <>
      <ScreenHeader {...(description !== undefined ? { title, description } : { title })} />

      {flag !== undefined && !FLAGS[flag].enabled && (
        <div className="mb-4">
          <FeatureDisabled flag={flag} state={FLAGS[flag]} title={title} />
        </div>
      )}

      {children}

      <Card className="mt-4">
        <h2 className="text-sm font-semibold">Planned behaviour</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
          {plannedBehaviour.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        {dependsOn !== undefined && dependsOn.length > 0 && (
          <>
            <h2 className="mt-4 text-sm font-semibold">Blocked on</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--tone-caution-fg)]">
              {dependsOn.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-4 text-xs text-[var(--text-muted)]">{t.app.demoFundsNote}</p>
      </Card>
    </>
  );
}
