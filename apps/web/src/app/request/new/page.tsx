'use client';

import { useState } from 'react';
import { ScreenHeader } from '@/components/primitives/Surface';
import { ButtonLink } from '@/components/primitives/Button';
import { CreateRequest } from '@/components/payments/CreateRequest';
import { useT } from '@/lib/i18n/provider';
import { PROTECTED_SETUP } from '@/lib/protected/hooks';

/**
 * Amount-first Instant Pay request (docs/UX_ONE_TAP_REDESIGN.md). Protected Pay
 * is linked only on a build whose Protected setup is complete (flag + separate
 * escrow contract); production has neither, so nothing changes there.
 */
export default function RequestNewPage() {
  const t = useT();
  // The review step brings its own title ("Payment request"); one heading per screen.
  const [step, setStep] = useState<0 | 1>(0);
  return (
    <>
      {step === 0 && <ScreenHeader title={t.oneTap.request.title} />}
      <CreateRequest onStepChange={setStep} />
      {step === 0 && PROTECTED_SETUP.status === 'ready' && (
        <div className="mt-4">
          <ButtonLink href="/protected/new" block>
            {t.protectedFlow.newTitle}
          </ButtonLink>
        </div>
      )}
    </>
  );
}
