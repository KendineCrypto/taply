'use client';

import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { useMainnetLocale } from '@/lib/mainnet/copy';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { Notice } from './bits';

/** Explicit no-cost message proof for wallets that omit their key at sign-in. */
export function ExternalWalletVerification({ testId = 'external-no-key' }: { readonly testId?: string }) {
  const w = useMainnetWallet(); const tr = useMainnetLocale().locale === 'tr';
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  return <div className="surface-card flex flex-col gap-3 p-5" data-testid={testId}>
    <h2 className="font-semibold">{tr ? 'Cüzdan bağlantısını doğrula' : 'Verify your wallet connection'}</h2>
    <p className="text-sm text-[var(--text-secondary)]">{tr ? 'Cüzdanın açık anahtarını öğrenmek için ücretsiz bir mesaj imzası gerekiyor. Para gönderilmez ve erişim anahtarı eklenmez.' : 'Sign a free connection message so Taply can identify your wallet key. No funds are sent and no access key is added.'}</p>
    <Button disabled={busy || typeof w.verifyKey !== 'function'} onClick={async () => { if (busy) return; setBusy(true); setFailed(false); try { await w.verifyKey(); } catch { setFailed(true); } finally { setBusy(false); } }}>{busy ? (tr ? 'Cüzdan bekleniyor…' : 'Waiting for wallet…') : (tr ? 'Cüzdanı doğrula' : 'Verify wallet')}</Button>
    {failed && <Notice tone="caution" live>{tr ? 'Doğrulama tamamlanamadı. İptal ettiysen tekrar deneyebilirsin. Cüzdan mesaj imzalamayı desteklemiyorsa başka bir cüzdan bağla.' : 'Verification did not complete. Retry if you cancelled. If your wallet does not support message signing, connect another wallet.'}</Notice>}
    <Button variant="ghost" onClick={() => void w.connect()} disabled={busy}>{tr ? 'Başka cüzdan bağla' : 'Connect another wallet'}</Button>
  </div>;
}
