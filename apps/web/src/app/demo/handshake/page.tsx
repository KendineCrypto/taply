'use client';

import { ScreenHeader } from '@/components/primitives/Surface';
import { HandshakeDemo } from '@/components/handshake/HandshakeDemo';
import { useT } from '@/lib/i18n/provider';

/** DEMO-only Handshake preview. Synthetic data, no network, no wallet, no payment state. */
export default function HandshakeDemoPage() {
  const t = useT();
  return (
    <>
      <ScreenHeader title={t.commerce.demo.title} description={t.commerce.demo.intro} />
      <HandshakeDemo />
    </>
  );
}
