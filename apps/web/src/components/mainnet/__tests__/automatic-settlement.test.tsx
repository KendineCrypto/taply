import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const verify = vi.hoisted(() => vi.fn());
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), verifyMainnetGiftSettlement: verify }));
vi.mock('@/lib/mainnet/copy', () => ({ useMainnetLocale: () => ({ locale: 'en' }) }));
vi.mock('@/lib/mainnet/config', () => ({ MAINNET_CONFIG: { ok: true, profile: null } }));
vi.mock('@/lib/mainnet/gift-profile', () => ({ GIFT_PROFILE: { contract: { accountId: 'gift.near' } } }));
vi.mock('@/lib/mainnet/wallet-ops', () => ({ signingProfiles: () => null, USDC_CODE_HASH: null }));
const { SettlementCheck, rememberSettlementTransaction } = await import('../Settlement');
const ID = 'a'.repeat(32), HASH = '1'.repeat(32);
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });
it('checks saved public transaction references automatically; local data alone never proves success', async () => {
  rememberSettlementTransaction('gift', ID, HASH, 'friend.near');
  verify.mockResolvedValue({ kind: 'VERIFIED_GIFT_SETTLEMENT', status: 'CLAIMED', giftId: ID });
  render(<SettlementCheck kind="gift" id={ID} automatic />);
  await waitFor(() => expect(verify).toHaveBeenCalledWith(expect.anything(), { giftId: ID, operations: [{ transactionHash: HASH, signerAccountId: 'friend.near' }] }));
  expect((await screen.findByTestId('settlement-result')).textContent).toContain('Gift settlement found: CLAIMED');
  expect(screen.getByTestId('settlement-result').querySelector('[data-kind="VERIFIED"]')).toBeTruthy();
});
it('an unresolved receipt graph is never shown as a verified settlement', async () => {
  rememberSettlementTransaction('gift', ID, HASH, 'friend.near'); verify.mockResolvedValue({ kind: 'NOT_VERIFIED', reason: 'UNRESOLVED' });
  render(<SettlementCheck kind="gift" id={ID} automatic />);
  const result = await screen.findByTestId('settlement-result');
  expect(result.querySelector('[data-kind="VERIFIED"]')).toBeNull(); expect(result.textContent).toContain('Nothing is assumed');
});
it('corrupt stored evidence is not passed to the verifier', async () => {
  sessionStorage.setItem(`taply.mainnet.receipt:gift:${ID}`, 'not a transaction or secret');
  render(<SettlementCheck kind="gift" id={ID} automatic />); await Promise.resolve();
  expect(verify).not.toHaveBeenCalled(); expect(screen.queryByTestId('settlement-result')).toBeNull();
});
it('retry evidence preserves order and deduplicates hashes instead of dropping the first operation', () => {
  rememberSettlementTransaction('gift', ID, HASH, 'friend.near');
  rememberSettlementTransaction('gift', ID, '2'.repeat(32), 'friend.near');
  rememberSettlementTransaction('gift', ID, HASH, 'friend.near');
  expect(sessionStorage.getItem(`taply.mainnet.receipt:gift:${ID}`)).toBe(`${HASH} friend.near\n${'2'.repeat(32)} friend.near`);
});
