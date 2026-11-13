import { notFound } from 'next/navigation';
import { MainnetHome } from '@/components/mainnet/MainnetHome';
import { IS_MAINNET_BUILD } from '@/lib/mainnet/build';

export default function MainnetHomePage() {
  if (!IS_MAINNET_BUILD) notFound();
  return <MainnetHome />;
}
