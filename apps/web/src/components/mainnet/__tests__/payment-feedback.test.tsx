import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fixtureRequests } from '@/lib/mainnet/fixtures';
const state = vi.hoisted(() => ({ read: {} as Record<string, unknown>, gift: {} as Record<string, unknown>, refresh: vi.fn(), run: vi.fn(), direct: vi.fn(), allowRetry: false, prepared: null as unknown }));
vi.mock('@/lib/mainnet/hooks', () => ({ useMainnetRequest: () => ({ read: state.read, refresh: state.refresh }) }));
vi.mock('@/lib/mainnet/use-gift', () => ({ useMainnetGift: () => ({ read: state.gift, refresh: state.refresh }) }));
vi.mock('@/lib/mainnet/copy', () => ({ useMainnetLocale: () => ({ locale: 'en' }) }));
vi.mock('@/lib/mainnet/config', () => ({ MAINNET_CONFIG: { ok: true, explorerBaseUrl: 'https://nearblocks.io' } }));
vi.mock('@/lib/mainnet/gift-profile', () => ({ GIFT_PROFILE: {} }));
vi.mock('../Wallet', () => ({ readProfile: () => ({ network: 'near-mainnet' }) }));
vi.mock('../Settlement', () => ({ SettlementCheck: () => null, rememberSettlementTransaction: vi.fn() }));
vi.mock('@/components/payments/QrCode', () => ({ QrCode: () => <div data-testid="qr">QR</div> }));
vi.mock('@/components/experience/ReceiptTicket', () => ({ ReceiptTicket: ({ status, recipientAccountId }: { status: string; recipientAccountId: string }) => <div data-testid="receipt" data-status={status}>{recipientAccountId}</div> }));
vi.mock('../Operation', () => ({
  useOperation: () => ({ signer: { kind: 'ok', accountId: 'friend.near' }, busy: false, error: '', prepared: state.prepared, run: state.run }),
  OperationError: () => null,
  OperationReview: ({ onDone }: { onDone: (v: unknown) => void }) => <button onClick={() => onDone({ kind: 'FINAL_EXECUTION', execution: 'SUCCESS', transactionHash: '1'.repeat(32) })}>Confirm fixture</button>,
}));
vi.mock('@taply/near-client', async original => ({ ...await original<Record<string, unknown>>(), signMainnetGiftClaim: async () => 'a'.repeat(128), verifyMainnetDirectTransfer: state.direct, prepareMainnetGiftSettlement: ({ action }: { action: string }) => { if (state.allowRetry && action === 'retry') return {}; throw Error('NO_OTHER_ACTION'); } }));
const { RequestShare } = await import('../RequestShare');
const { OpenGiftPage, PersonalGiftOpen } = await import('../GiftPages');
afterEach(() => { cleanup(); sessionStorage.clear(); history.replaceState(null, '', '/'); state.prepared = null; state.allowRetry = false; vi.clearAllMocks(); });
const gift = { id: 'a'.repeat(32), creator: 'sender.near', amountYocto: '100000000000000000000000', design: 0, message: 'For you!', expiresAtNs: '1999999999999999999', status: 'AVAILABLE', payout: null, beneficiary: null };
const readGift = (patch = {}) => ({ kind: 'ok', config: { contractId: 'gift.near' }, nowNs: '1000000000000000000', data: { ...gift, ...patch } });
it('creator QR becomes a receipt only after FINAL_PAID and a successful payout, without another payment action', () => {
  const paid = fixtureRequests(Date.now()).find(e => e.scenario.name === 'usdc-recorded')!.request;
  state.read = { kind: 'ok', fixture: false, request: { ...paid, status: 'OPEN', latestOperation: null } };
  const view = render(<RequestShare id={paid.terms.id} link="https://taply.example/m/pay/id" amount="1 USDC" />);
  expect(screen.getByTestId('qr')).toBeTruthy(); expect(screen.queryByTestId('receipt')).toBeNull();
  state.read = { kind: 'ok', fixture: false, request: { ...paid, status: 'PAYOUT_IN_FLIGHT' } }; view.rerender(<RequestShare id={paid.terms.id} link="https://taply.example/m/pay/id" amount="1 USDC" />);
  expect(screen.queryByTestId('receipt')).toBeNull(); expect(screen.getByRole('status').textContent).toBe('Completing payment…');
  state.read = { kind: 'ok', fixture: false, request: paid }; view.rerender(<RequestShare id={paid.terms.id} link="https://taply.example/m/pay/id" amount="1 USDC" />);
  expect(screen.getByTestId('request-paid')).toBeTruthy(); expect(screen.queryByTestId('qr')).toBeNull();
  expect(screen.getByTestId('receipt').getAttribute('data-status')).toBe('contract_paid');
});
it('an unavailable creator read never turns into a receipt', () => {
  state.read = { kind: 'error' }; render(<RequestShare id={'a'.repeat(64)} link="https://taply.example" amount="1 NEAR" />);
  expect(screen.queryByTestId('receipt')).toBeNull(); expect(screen.getByText(/Payment is not confirmed/)).toBeTruthy();
});
it('unwrap is visual only; submitted claim waits for FINAL contract payout before showing success', async () => {
  state.gift = readGift(); history.replaceState(null, '', '/#k=' + 'a'.repeat(64));
  const view = render(<OpenGiftPage id={gift.id} />);
  expect(screen.queryByTestId('og-sign')).toBeNull(); fireEvent.click(screen.getByTestId('og-unwrap'));
  expect(state.run).not.toHaveBeenCalled(); expect(screen.getByText('For you!')).toBeTruthy();
  await vi.waitFor(() => expect(screen.getByTestId('og-sign')).toBeTruthy());
  fireEvent.click(screen.getByTestId('og-sign')); await vi.waitFor(() => expect(state.run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'giftClaim', giftId: gift.id })));
  state.prepared = {}; view.rerender(<OpenGiftPage id={gift.id} />); fireEvent.click(screen.getByText('Confirm fixture'));
  expect(state.refresh).toHaveBeenCalled(); expect(screen.queryByTestId('og-success')).toBeNull(); expect(screen.queryByTestId('og-sign')).toBeNull();
  state.gift = readGift({ status: 'CLAIMED', payout: 'PENDING', beneficiary: 'friend.near' }); view.rerender(<OpenGiftPage id={gift.id} />);
  expect(screen.queryByTestId('og-success')).toBeNull();
  state.gift = readGift({ status: 'CLAIMED', payout: 'CONFIRMED', beneficiary: 'friend.near' }); view.rerender(<OpenGiftPage id={gift.id} />);
  expect(screen.getByTestId('og-success').textContent).toContain('friend.near'); expect(screen.queryByText('Confirm fixture')).toBeNull();
});
it('failed and pending gift payouts never show the success treatment', () => {
  state.gift = readGift({ status: 'CLAIMED', payout: 'FAILED', beneficiary: 'friend.near' }); render(<OpenGiftPage id={gift.id} />);
  expect(screen.queryByTestId('og-success')).toBeNull(); expect(screen.getByText('Transfer did not complete')).toBeTruthy();
});

it('Personal Gift unwrap automatically checks the exact transfer and never submits a claim', async () => {
  const payload = { v: 1, network: 'near-mainnet', from: 'sender.near', to: 'friend.near', amountYocto: '100000000000000000000000', txHash: '1'.repeat(32), message: 'Enjoy!', design: 0 };
  history.replaceState(null, '', '/#p=' + btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'));
  state.direct.mockResolvedValue({ kind: 'VERIFIED' }); render(<PersonalGiftOpen />);
  fireEvent.click(await screen.findByTestId('pg-unwrap'));
  await vi.waitFor(() => expect(state.direct).toHaveBeenCalledWith(expect.anything(), { txHash: payload.txHash, from: payload.from, to: payload.to, amountYocto: payload.amountYocto }));
  expect((await screen.findByTestId('pg-result')).querySelector('[data-kind="VERIFIED"]')).toBeTruthy();
  expect(screen.getByText('Enjoy!')).toBeTruthy(); expect(state.run).not.toHaveBeenCalled();
});

it('a failed payout exposes exactly one retry review and never offers a new claim', async () => {
  state.allowRetry = true; state.gift = readGift({ status: 'CLAIMED', payout: 'FAILED', beneficiary: 'friend.near' });
  const view = render(<OpenGiftPage id={gift.id} />);
  fireEvent.click(screen.getByTestId('og-retry-review'));
  expect(state.run).toHaveBeenCalledWith({ kind: 'giftRetry', giftId: gift.id });
  state.prepared = {}; view.rerender(<OpenGiftPage id={gift.id} />);
  expect(screen.getByTestId('og-retry-ready')).toBeTruthy();
  expect(screen.getAllByText('Confirm fixture')).toHaveLength(1); expect(screen.queryByTestId('og-sign')).toBeNull();
});
it('an expired gift is visibly labelled before unwrapping and cannot be claimed', () => {
  state.gift = readGift({ status: 'EXPIRED' }); render(<OpenGiftPage id={gift.id} />);
  expect(screen.getByRole('heading', { name: 'Expired' })).toBeTruthy();
  fireEvent.click(screen.getByTestId('og-unwrap')); expect(screen.queryByTestId('og-sign')).toBeNull();
});
