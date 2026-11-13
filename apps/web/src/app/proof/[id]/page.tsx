'use client';

import { useParams } from 'next/navigation';
import { ReceiptScreen } from '@/components/payments/ReceiptScreen';
import { HashHexSchema } from '@/lib/protocol';

/**
 * READ-ONLY embeddable proof. ReceiptScreen performs the SAME live, independent
 * on-chain verification as /receipt/:id. Query hints are not trusted evidence.
 * Never show a Verified Paid claim from a request ID, URL or archived record.
 *
 * The shell and response headers deliberately treat only /proof/:id as frameable.
 * There are no signing controls on this surface.
 */
export default function ProofPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <section aria-label="Taply payment verification" className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
        <span className="text-lg font-semibold tracking-tight text-[var(--taply-lime)]">taply.</span>
        <span className="rounded-full border border-[var(--border-strong)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
          NEAR TESTNET · LIVE CHECK
        </span>
      </header>
      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
        Independent blockchain verification. A reference or screenshot is not proof.
        If network evidence is unavailable, this panel will not claim Verified Paid.
      </p>
      <ReceiptScreen id={id} />
      {HashHexSchema.safeParse(id).success && (
        <a
          href={`/receipt/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-strong)] px-3 text-sm font-medium text-[var(--text-primary)]"
        >
          Open full receipt at Taply ↗
        </a>
      )}
      <p className="text-center text-[11px] text-[var(--text-muted)]">
        Experimental · Unreviewed · Test funds only
      </p>
    </section>
  );
}
