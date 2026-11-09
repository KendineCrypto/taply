import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SwapSnapshot } from '@taply/near-client';
import { TESTNET_USDC_ROUTE } from '@taply/near-client';
import { I18nProvider } from '@/lib/i18n/provider';
import type { SignOutcome, WalletCall } from '@/lib/wallet/adapter';
import { UsdcPay, testUsdcPurchaseNear } from '../UsdcPay';
import type { SwapTxResult, UsdcPayDeps } from '../UsdcPay';

/** Deterministic pool (Testnet pool 1103 after the probe) and a recording wallet. Nothing reaches NEAR. */
const NEAR = 10n ** 24n;
const HASH = '4mryuMrJC1gTT4pbCLdvHdu3c6e2wBpt3WNe5L2tP7XU';
function snap(over: Partial<SwapSnapshot['payer']> = {}): SwapSnapshot {
  return {
    route: TESTNET_USDC_ROUTE, blockHash: '1'.repeat(32), blockHeight: '1',
    tokenReserve: '57744697537784089814302612588', nearReserve: '27390188960113886565427550613', feeBps: 30,
    payer: { accountId: 'payer.testnet', tokenBalance: '3000000000000000000000000', tokenRegistered: true, wrappedNearRegistered: true, ...over },
    tokenStorageMinYocto: '1250000000000000000000', wrappedNearStorageMinYocto: '1250000000000000000000',
  };
}
function setup(snapshots: SwapSnapshot[], results: SwapTxResult[] = ['pending', 'success'], outcome: SignOutcome = { kind: 'submitted', transactionHash: HASH }) {
  const calls: WalletCall[] = [];
  let i = 0;
  const deps: UsdcPayDeps = {
    read: vi.fn(async () => snapshots[Math.min(i++, snapshots.length - 1)] ?? snap()),
    observe: vi.fn(async () => results.shift() ?? 'success'),
    sleep: async () => {},
  };
  const signAndSend = vi.fn(async (call: WalletCall) => { calls.push(call); return outcome; });
  const onConverted = vi.fn();
  render(
    <I18nProvider locale="en">
      <UsdcPay amountYocto={(NEAR / 2n).toString()} signerAccountId="payer.testnet" signAndSend={signAndSend} onConverted={onConverted} deps={deps} />
    </I18nProvider>,
  );
  return { calls, deps, onConverted };
}
afterEach(cleanup);

describe('pay a NEAR request with test USDC', () => {
  it('quotes exactly from the pool, converts with one clearly labelled step, then hands over to the NEAR payment', async () => {
    const { calls, onConverted } = setup([snap(), snap({ tokenBalance: '1900000000000000000000000' })]);
    expect(await screen.findByText(/Convert 1\.0625 USDC → at least 0\.5 NEAR/)).toBeTruthy();
    expect(screen.getByText(/usdc\.itachicara\.testnet · test token, no real value/)).toBeTruthy();
    expect(screen.getByText('Recipient receives').nextElementSibling?.textContent).toBe('0.5 NEAR');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Step 1 of 2 · Convert 1\.0625 USDC to NEAR/ }));
    });
    await waitFor(() => expect(screen.getByText(/Converted\. You now hold the NEAR/)).toBeTruthy());
    expect(onConverted).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call).toMatchObject({ receiverId: 'usdc.itachicara.testnet', methodName: 'ft_transfer_call', depositYocto: '1' });
    expect(call?.actions).toBeUndefined();
    const msg = JSON.parse(String(call?.args['msg'])) as { skip_unwrap_near: boolean; actions: Array<{ min_amount_out: string; pool_id: number }> };
    expect(msg.skip_unwrap_near).toBe(false);
    expect(msg.actions[0]).toMatchObject({ pool_id: 1103, min_amount_out: (NEAR / 2n).toString() });
  });

  it('a failed swap (refunded) is never shown as converted', async () => {
    const { onConverted } = setup([snap()], ['failed']);
    const target = await screen.findByRole('button', { name: /Step 1 of 2/ });
    await act(async () => {
      fireEvent.click(target);
    });
    expect(await screen.findByText(/swap did not go through/)).toBeTruthy();
    expect(screen.queryByText(/Converted\./)).toBeNull();
    expect(onConverted).not.toHaveBeenCalled();
  });

  it('an unknown wallet result blocks a blind retry until balances are re-checked', async () => {
    const { calls } = setup([snap()], [], { kind: 'unknown' });
    const target = await screen.findByRole('button', { name: /Step 1 of 2/ });
    await act(async () => {
      fireEvent.click(target);
    });
    expect(await screen.findByText(/did not report a result/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Step 1 of 2/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check balances' }));
    expect(await screen.findByRole('button', { name: /Step 1 of 2/ })).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it('unregistered payer: one-time registration; without enough USDC: buy test USDC in one wrap.testnet transaction', async () => {
    const { calls } = setup([snap({ tokenRegistered: false, tokenBalance: '0', wrappedNearRegistered: false }), snap({ tokenBalance: '0', wrappedNearRegistered: false })]);
    const target = await screen.findByRole('button', { name: 'Enable test USDC' });
    await act(async () => {
      fireEvent.click(target);
    });
    expect(calls[0]).toMatchObject({ receiverId: 'usdc.itachicara.testnet', methodName: 'storage_deposit', depositYocto: '1250000000000000000000' });
    const buy = await screen.findByRole('button', { name: /Get test USDC \(swap 0\.53 NEAR\)/ });
    expect(screen.getByText('Not enough test USDC for this payment.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(buy);
    });
    expect(calls[1]?.receiverId).toBe('wrap.testnet');
    expect(calls[1]?.actions?.map((a) => a.methodName)).toEqual(['storage_deposit', 'near_deposit', 'ft_transfer_call']);
    expect(calls[1]?.actions?.[1]?.depositYocto).toBe(testUsdcPurchaseNear(NEAR / 2n).toString());
  });

  it('purchase amount: request + 5%, rounded up to 0.01 NEAR, at least 0.1 NEAR', () => {
    expect(testUsdcPurchaseNear(NEAR)).toBe(105n * 10n ** 22n);
    expect(testUsdcPurchaseNear(10n ** 21n)).toBe(10n ** 23n);
    expect(testUsdcPurchaseNear(NEAR / 2n)).toBe(53n * 10n ** 22n);
  });
});
