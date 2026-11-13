import { notFound } from 'next/navigation';
import { LiveCustomer } from '@/components/mainnet/Live';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

/** Live Handshake, customer side (mainnet build only). */
export default async function MainnetLiveSessionPage({ params }: { readonly params: Promise<{ readonly roomId: string }> }) {
  if (!IS_MAINNET_BUILD) notFound();
  const { roomId } = await params;
  if (!/^[A-Za-z0-9_-]{22}$/.test(roomId)) notFound();
  return <LiveCustomer roomId={roomId} />;
}
