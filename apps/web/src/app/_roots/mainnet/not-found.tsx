import Link from 'next/link';
import { Card, ScreenHeader } from '@/components/primitives/Surface';

/** Mainnet not-found page: hook-free, no Testnet dictionaries. */
export default function NotFound() {
  return (
    <>
      <ScreenHeader title="Not found / Bulunamadı" />
      <Card>
        <Link href="/m" className="inline-flex text-[var(--taply-lime)] underline">Taply · NEAR Mainnet</Link>
      </Card>
    </>
  );
}
