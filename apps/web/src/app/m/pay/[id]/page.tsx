import { notFound } from 'next/navigation';
import { PayWithLive } from '@/components/mainnet/Live';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

export default async function MainnetPayPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  if (!IS_MAINNET_BUILD) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{64}$/.test(id)) notFound();
  return <PayWithLive id={id} />;
}
