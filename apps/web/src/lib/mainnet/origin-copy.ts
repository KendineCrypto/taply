import type { OriginChain, RefundFormat } from './oneclick/allowlist';

/** Origin-chain names and refund-address help (EN/TR). */
export const ORIGIN_COPY = {
  en: {
    chain: { base: 'Base', sol: 'Solana', tron: 'Tron' } as Record<OriginChain, string>,
    refundLabel: { evm: 'Your Base refund address', solana: 'Your Solana refund address', tron: 'Your Tron refund address' } as Record<RefundFormat, string>,
    refundPlaceholder: { evm: '0x…', solana: 'Solana wallet address', tron: 'T…' } as Record<RefundFormat, string>,
    refundFormat: { evm: 'Enter a Base address: 0x followed by 40 hex characters.', solana: 'Enter a Solana wallet address (base58, 32 bytes).', tron: 'Enter a Tron address starting with T.' } as Record<RefundFormat, string>,
    solanaNote: 'Use a wallet address you control, not a program or token account.',
    tronNote: 'You pay USDT on Tron; the merchant still receives exactly the requested USDC on NEAR.',
    loading: 'Loading supported networks…',
    none: 'No cross-chain route is available right now.',
    fixture: 'FIXTURE route list',
    send: 'You send on {chain}',
  },
  tr: {
    chain: { base: 'Base', sol: 'Solana', tron: 'Tron' } as Record<OriginChain, string>,
    refundLabel: { evm: 'Base iade adresiniz', solana: 'Solana iade adresiniz', tron: 'Tron iade adresiniz' } as Record<RefundFormat, string>,
    refundPlaceholder: { evm: '0x…', solana: 'Solana cüzdan adresi', tron: 'T…' } as Record<RefundFormat, string>,
    refundFormat: { evm: 'Bir Base adresi girin: 0x ve ardından 40 onaltılık karakter.', solana: 'Bir Solana cüzdan adresi girin (base58, 32 bayt).', tron: 'T ile başlayan bir Tron adresi girin.' } as Record<RefundFormat, string>,
    solanaNote: 'Kontrolünüzdeki bir cüzdan adresi kullanın; program veya token hesabı değil.',
    tronNote: 'Tron üzerinde USDT ödersiniz; işletme NEAR üzerinde yine tam olarak istenen USDC\'yi alır.',
    loading: 'Desteklenen ağlar yükleniyor…',
    none: 'Şu anda kullanılabilir zincirler arası rota yok.',
    fixture: 'FİKSTÜR rota listesi',
    send: '{chain} üzerinde göndereceğiniz',
  },
};
