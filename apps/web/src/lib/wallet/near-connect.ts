import type { NearConnector } from '@hot-labs/near-connect';
import { classifyAccountId, isRejectedAccount } from '@/lib/near/account';
import { WalletError, WalletNotDispatchedError, classifyWalletError } from './adapter';
import { transactionHashOf } from './adapter';
import type { SignOutcome, WalletAdapter, WalletCall, WalletSession } from './adapter';

/**
 * NEAR Connect adapter (`@hot-labs/near-connect`).
 *
 * Chosen because docs.near.org's current wallet-login tutorial recommends it
 * (checked 2026-10-29): wallets run inside sandboxed iframes, it has zero runtime
 * dependencies, and it supports Testnet explicitly.
 *
 * Configuration decisions:
 *  - `network: 'testnet'` - the connector then lists only wallets whose manifest
 *    declares Testnet support. There is no mainnet code path here.
 *  - `features.signInWithoutAddKey` - sign-in must not add a function-call key,
 *    so Taply never ends up holding a key.
 *  - `features.signAndSendTransaction` - only offer wallets that can sign later,
 *    so nobody connects a wallet that cannot complete a payment.
 *  - `autoConnect: false` - never connect without an explicit tap.
 *  - The SDK is imported lazily: it touches IndexedDB/window on construction,
 *    and keeping it out of the server render and the first JS chunk is cheaper.
 */

let connectorPromise: Promise<NearConnector> | null = null;

function getConnector(rpcUrl: string): Promise<NearConnector> {
  if (connectorPromise === null) {
    connectorPromise = import('@hot-labs/near-connect').then(
      ({ NearConnector: Connector }) =>
        new Connector({
          network: 'testnet',
          providers: { testnet: [rpcUrl] },
          features: { testnet: true, signInWithoutAddKey: true, signAndSendTransaction: true },
          autoConnect: false,
          footerBranding: null,
        }),
    );
    // A failed import must not poison every later attempt.
    connectorPromise.catch(() => {
      connectorPromise = null;
    });
  }
  return connectorPromise;
}

function toSession(
  accounts: ReadonlyArray<{ readonly accountId: string }> | undefined,
  wallet: { readonly manifest: { readonly id: string; readonly name: string } },
): WalletSession {
  const accountId = accounts?.[0]?.accountId;
  if (typeof accountId !== 'string' || isRejectedAccount(classifyAccountId(accountId))) {
    throw new WalletError('no_account');
  }
  return { accountId, walletId: wallet.manifest.id, walletName: wallet.manifest.name };
}

export function createNearConnectAdapter(rpcUrl: string): WalletAdapter {
  return {
    async restore() {
      let connector: NearConnector;
      try {
        connector = await getConnector(rpcUrl);
      } catch (cause) {
        throw new WalletError('unavailable', { cause });
      }
      try {
        const { wallet, accounts } = await connector.getConnectedWallet();
        return toSession(accounts, wallet);
      } catch {
        // "No wallet selected" / "No accounts found" both just mean: not connected.
        return null;
      }
    },

    async connect() {
      let connector: NearConnector;
      try {
        connector = await getConnector(rpcUrl);
      } catch (cause) {
        throw new WalletError('unavailable', { cause });
      }
      try {
        await connector.whenManifestLoaded;
        if (connector.availableWallets.length === 0) throw new WalletError('unavailable');
        const wallet = await connector.connect();
        const accounts = await wallet.getAccounts({ network: 'testnet' });
        return toSession(accounts, wallet);
      } catch (cause) {
        throw new WalletError(classifyWalletError(cause), { cause });
      }
    },

    async disconnect() {
      const connector = await getConnector(rpcUrl);
      try {
        await connector.disconnect();
      } catch {
        // Already disconnected on the wallet side; local state is cleared by the caller.
      }
    },

    async signAndSendTransaction(signerAccountId: string, call: WalletCall): Promise<SignOutcome> {
      let connector: NearConnector;
      try {
        connector = await getConnector(rpcUrl);
      } catch (cause) {
        throw new WalletError('unavailable', { cause });
      }
      // Never let a wallet sign as a different account than the one reviewed.
      let session: WalletSession;
      try {
        const { wallet, accounts } = await connector.getConnectedWallet();
        session = toSession(accounts, wallet);
      } catch {
        // No signing method has been invoked on this path.
        throw new WalletNotDispatchedError();
      }
      if (session.accountId !== signerAccountId) throw new WalletNotDispatchedError();

      try {
        const wallet = await connector.wallet();
        const outcome: unknown = await wallet.signAndSendTransaction({
          network: 'testnet',
          signerId: signerAccountId,
          receiverId: call.receiverId,
          actions: [
            {
              type: 'FunctionCall',
              params: { methodName: call.methodName, args: { ...call.args }, gas: call.gas, deposit: call.depositYocto },
            },
          ],
        });
        const transactionHash = transactionHashOf(outcome);
        return transactionHash === null ? { kind: 'unknown' } : { kind: 'submitted', transactionHash };
      } catch {
        // No trusted no-broadcast signal exists across the SDK/wallet boundary.
        // Includes cancellation text/codes, redirects and malformed outcomes.
        return { kind: 'unknown' };
      }
    },

    subscribe(listener) {
      let active = true;
      let teardown: (() => void) | null = null;

      void getConnector(rpcUrl)
        .then((connector) => {
          if (!active) return;
          const onSignIn = (payload: {
            wallet: { manifest: { id: string; name: string } };
            accounts: Array<{ accountId: string }>;
          }) => {
            try {
              listener(toSession(payload.accounts, payload.wallet));
            } catch {
              listener(null);
            }
          };
          const onSignOut = () => listener(null);
          connector.on('wallet:signIn', onSignIn);
          connector.on('wallet:signOut', onSignOut);
          teardown = () => {
            connector.off('wallet:signIn', onSignIn);
            connector.off('wallet:signOut', onSignOut);
          };
        })
        .catch(() => {
          // Load failure is reported by restore()/connect(); nothing to subscribe to.
        });

      return () => {
        active = false;
        teardown?.();
      };
    },
  };
}
