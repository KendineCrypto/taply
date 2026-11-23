import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CrosschainSwap } from '../CrosschainSwap';
import { PENDING_KEY, SECRET_KEY } from '@/lib/mainnet/crosschain/client';
vi.mock('@/lib/mainnet/copy', () => ({ useMainnetLocale: () => ({ locale: 'en' }) }));
vi.mock('../../MainnetShell', () => ({ useCurrentMainnetAccount: () => ({ accountId: 'alice.near' }) }));
vi.mock('@/components/payments/QrCode', () => ({ QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));
const input = { from: 'base', to: 'near', amount: '1000000', recipient: 'alice.near', refundTo: '0x' + '1'.repeat(40), slippageBps: 50 };
const quote = () => ({ input, correlationId: 'test-id', amountIn: '1000000', amountOut: '990000', minAmountOut: '985050', deadline: new Date(Date.now() + 900000).toISOString(), createdAt: Date.now(), estimate: 35, deposit: null, memo: null, funded: false });
let session: unknown = null;
const handler = vi.fn(async (url: string, options?: RequestInit) => {
  if (url.endsWith('/session')) return Response.json(session);
  if (url.endsWith('/quote')) { const body = JSON.parse(String(options?.body)); const q = { ...quote(), funded: body.fund, deposit: body.fund ? '0x' + '2'.repeat(40) : null }; if (body.fund) session = { quote: q, state: 'ready', upstream: 'PENDING_DEPOSIT', proof: null, refundProof: null }; return Response.json(q); }
  if (url.endsWith('/archive')) return Response.json({ ok: true });
  return Response.json({ mode: 'funded' });
});
beforeEach(() => { localStorage.clear(); session = null; handler.mockClear(); vi.stubGlobal('fetch', handler); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function form() {
  render(<CrosschainSwap />);
  await waitFor(() => expect(localStorage.getItem(SECRET_KEY)).toHaveLength(64));
  fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Your refund address'), { target: { value: input.refundTo } });
  await waitFor(() => expect((screen.getByText('Get quote') as HTMLButtonElement).disabled).toBe(false));
}
it('reviews a dry quote before creating one fundable address', async () => {
  await form(); fireEvent.click(screen.getByText('Get quote'));
  await screen.findByText('Review swap'); expect(screen.queryByTestId('qr')).toBeNull();
  expect(screen.getByText(/Funded swaps have not yet been verified end to end/)).toBeTruthy();
  fireEvent.click(screen.getByText('Review swap')); fireEvent.click(screen.getByText('Create payment address'));
  await screen.findByTestId('qr'); expect(localStorage.getItem(PENDING_KEY)).toBe('1');
  expect(handler.mock.calls.filter(([url, opts]) => url.endsWith('/quote') && JSON.parse(String(opts?.body)).fund)).toHaveLength(1);
});
it('never displays a stale quote after the amount changes', async () => {
  await form(); let resolve!: (r: Response) => void;
  handler.mockImplementationOnce(async () => new Promise<Response>(r => { resolve = r; }));
  fireEvent.click(screen.getByText('Get quote'));
  fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '2' } });
  resolve(Response.json(quote())); await waitFor(() => expect((screen.getByText('Get quote') as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText('Review swap')).toBeNull();
});
it('resumes after reload and does not turn provider SUCCESS into verified delivery', async () => {
  localStorage.setItem(PENDING_KEY, '1'); localStorage.setItem(SECRET_KEY, 'a'.repeat(64));
  session = { quote: { ...quote(), funded: true, deposit: '0x' + '2'.repeat(40) }, state: 'ready', upstream: 'SUCCESS', proof: { state: 'pending', amount: null, chain: 'near', txs: [], trust: 'configured-rpc' }, refundProof: null };
  render(<CrosschainSwap />); await screen.findByText('Delivery reported · checking on chain');
  expect(screen.queryByText('Swap complete')).toBeNull(); expect(screen.queryByText('Done')).toBeNull(); expect(screen.queryByTestId('qr')).toBeNull();
});
it('keeps an unknown attempt blocked after reload', async () => {
  localStorage.setItem(PENDING_KEY, '1'); localStorage.setItem(SECRET_KEY, 'a'.repeat(64));
  session = { quote: null, state: 'uncertain', upstream: null, proof: null, refundProof: null };
  render(<CrosschainSwap />); await screen.findByText('Needs attention');
  expect(screen.queryByText('Get quote')).toBeNull(); expect(screen.queryByText('Done')).toBeNull();
});
it('shows verified delivery and archives only through explicit Done', async () => {
  localStorage.setItem(PENDING_KEY, '1'); localStorage.setItem(SECRET_KEY, 'a'.repeat(64));
  session = { quote: { ...quote(), funded: true, deposit: '0x' + '2'.repeat(40) }, state: 'ready', upstream: 'SUCCESS', proof: { state: 'verified', amount: '990000', chain: 'near', txs: [], trust: 'configured-rpc' }, refundProof: null };
  render(<CrosschainSwap />); await screen.findByText('Swap complete'); fireEvent.click(screen.getByText('Done'));
  await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
});
