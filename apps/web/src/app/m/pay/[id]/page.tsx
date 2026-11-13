import { notFound } from 'next/navigation';
import { PayRequest } from '@/components/mainnet/PayRequest';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

export default async function MainnetPayPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  if (!IS_MAINNET_BUILD) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{64}$/.test(id)) notFound();
  return <PayRequest id={id} />;
}
