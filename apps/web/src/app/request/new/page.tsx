'use client';

import { useState } from 'react';
import { ScreenHeader } from '@/components/primitives/Surface';
import { CreateRequest } from '@/components/payments/CreateRequest';
import { useT } from '@/lib/i18n/provider';

/** Amount-first Instant Pay request (docs/UX_ONE_TAP_REDESIGN.md). Protected Pay is not offered. */
export default function RequestNewPage() {
  const t = useT();
  // The review step brings its own title ("Payment request"); one heading per screen.
  const [step, setStep] = useState<0 | 1>(0);
  return (
    <>
      {step === 0 && <ScreenHeader title={t.oneTap.request.title} />}
      <CreateRequest onStepChange={setStep} />
    </>
  );
}
