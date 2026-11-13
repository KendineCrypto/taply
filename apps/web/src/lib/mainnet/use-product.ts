'use client';

import { useEffect, useState } from 'react';
import { emptyProductData, loadProductData, saveProductData, type ProductData } from '@/lib/mainnet/product';
import { useMainnetWallet } from '@/lib/mainnet/wallet';
import { productEn, productTr } from '@/lib/mainnet/product-copy';
import { useMainnetLocale } from '@/lib/mainnet/copy';

function useProductCopy() { return useMainnetLocale().locale === 'tr' ? productTr : productEn; }

/** Only explicit user actions write local drafts. Account changes cannot display
 * or overwrite another account's data; invalid storage fails closed. */
export function useLocalProduct() {
  const { accountId } = useMainnetWallet(); const c = useProductCopy();
  const [state, setState] = useState<{ owner: string; data: ProductData } | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!accountId) return;
    let live = true;
    const read = () => {
      if (!live) return;
      try { setState({ owner: accountId, data: loadProductData(localStorage, accountId) }); setMessage(''); }
      catch { setState(null); setMessage(c.storageError); }
    };
    queueMicrotask(read);
    window.addEventListener('storage', read);
    return () => { live = false; window.removeEventListener('storage', read); };
  }, [accountId, c.storageError]);
  const data = state?.owner === accountId ? state.data : emptyProductData();
  const ready = accountId !== null && state?.owner === accountId;
  function save(next: ProductData) {
    if (!accountId || !ready) return;
    try { saveProductData(localStorage, accountId, next); setState({ owner: accountId, data: next }); setMessage(c.saved); }
    catch { setMessage(c.storageError); }
  }
  return { data, save, ready, message };
}

