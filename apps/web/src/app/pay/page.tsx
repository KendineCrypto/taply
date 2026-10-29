'use client';

import Link from 'next/link';
import { Card, ScreenHeader } from '@/components/primitives/Surface';
import { useT } from '@/lib/i18n/provider';

/**
 * Pay hub, reached from the bottom nav. `/pay/[id]` is the canonical intent
 * view; this index only routes a person toward one.
 */
export default function PayHubPage() {
  const t = useT();

  const options = [
    { href: '/scan' as const, label: t.screens.scan, body: 'Scan a sale or request QR code.' },
    { href: '/request/new' as const, label: t.screens.requestNew, body: 'Ask someone to pay you.' },
    { href: '/send' as const, label: t.screens.send, body: 'Send directly to an account ID.' },
  ];

  return (
    <>
      <ScreenHeader
        title={t.nav.pay}
        description="Every payment is reviewed in full and signed in your own wallet."
      />

      <ul className="flex flex-col gap-3">
        {options.map((option) => (
          <Card key={option.href} as="li" level={1} className="p-0">
            <Link href={option.href} className="tap-target flex flex-col gap-1 p-4">
              <span className="font-medium">{option.label}</span>
              <span className="text-sm text-[var(--text-secondary)]">{option.body}</span>
            </Link>
          </Card>
        ))}
      </ul>

      <Card className="mt-4">
        <p className="text-sm text-[var(--text-secondary)]">
          A swipe only opens your wallet — it never moves funds by itself, and every swipe control has a
          button and keyboard equivalent.
        </p>
      </Card>
    </>
  );
}
