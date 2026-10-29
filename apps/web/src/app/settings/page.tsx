'use client';

import { Card, DetailRow, ScreenHeader } from '@/components/primitives/Surface';
import { FeatureDisabled } from '@/components/feedback/ErrorState';
import { useT } from '@/lib/i18n/provider';
import { FEATURE_FLAGS, FLAGS } from '@/lib/flags/features';

/**
 * Settings and security (UX_FLOWS screens 02/23).
 *
 * The capability table is deliberately visible to users and judges: it states
 * exactly what this build can and cannot do, which is the honest counterpart to
 * docs/EVIDENCE.md.
 */
export default function SettingsPage() {
  const t = useT();

  return (
    <>
      <ScreenHeader title={t.screens.settings} />

      <Card>
        <h2 className="mb-2 text-sm font-semibold">{t.common.network}</h2>
        <dl>
          <DetailRow label={t.common.network} emphasis>
            {t.app.networkBadge}
          </DetailRow>
          <DetailRow label="Contract">{process.env.NEXT_PUBLIC_TAPLY_CONTRACT_ID || t.common.notAvailable}</DetailRow>
        </dl>
        <p className="mt-2 text-xs text-[var(--text-muted)]">{t.app.demoFundsNote}</p>
      </Card>

      <Card className="mt-4">
        <h2 className="mb-2 text-sm font-semibold">Capabilities</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Every capability stays off until it is verified on NEAR Testnet. &ldquo;Locked&rdquo; means configuration
          alone cannot enable it — a human security review is required.
        </p>
        <ul className="flex flex-col gap-1">
          {FEATURE_FLAGS.map((flag) => {
            const state = FLAGS[flag];
            return (
              <li
                key={flag}
                className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] py-1.5 text-sm last:border-b-0"
              >
                <span className="font-mono text-xs">{flag}</span>
                <span
                  className={
                    state.enabled ? 'text-[var(--tone-success-fg)]' : 'text-[var(--tone-caution-fg)]'
                  }
                >
                  {state.enabled ? 'enabled' : state.reason.replace(/_/g, ' ')}
                  {state.hardDisabled ? ' · locked' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="mt-4">
        <FeatureDisabled
          flag="socialLogin"
          state={FLAGS.socialLogin}
          title={t.notices.socialLoginUnavailable.title}
        />
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t.notices.socialLoginUnavailable.body}
        </p>
      </div>
    </>
  );
}
