'use client';

import { useEffect, useId, useState } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { ConnectWalletButton, WalletErrorNotice } from '@/components/wallet/WalletConnect';
import { InvalidAmountError, formatBaseUnits, toBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n/fill';
import { useLocale, useT } from '@/lib/i18n/provider';
import { classifyAccountId } from '@/lib/near/account';
import { displayableBalance } from '@/lib/near/balance';
import { getNearClient } from '@/lib/near/client';
import type { NearTestnetClient } from '@/lib/near/client';
import { useNativeBalance } from '@/lib/near/use-native-balance';
import { NEAR_NATIVE } from '@/lib/protocol';
import { useWallet } from '@/lib/wallet/provider';
import { ContactMatch, ContactPicker } from '@/components/contacts/ContactPicker';
import { FLAGS } from '@/lib/flags/features';
import { useContactBook } from '@/lib/contacts/use-contacts';
import { contactForAccount } from '@/lib/contacts/contacts';
import { SendReview } from './SendParts';

/**
 * /send - prepare and review a direct NEAR Testnet transfer.
 *
 * Everything up to the confirmation works with real reads: the recipient is
 * checked on Testnet (read-only `view_account`) and the available balance is a
 * finalized read. Confirming is unavailable in this build: the wallet adapter
 * has no direct-transfer signer (it signs contract calls only) and signing is
 * switched off. `SEND_SIGNER_AVAILABLE` must only become true together with a
 * reviewed adapter method and an explicit signing approval.
 */
export const SEND_SIGNER_AVAILABLE = false;

/** Leave room for gas so a reviewed amount can actually be sent. */
const GAS_RESERVE_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

export type RecipientCheck =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'self' }
  | { readonly kind: 'mainnet' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'found' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unchecked' };

/** Format-level checks that need no network. null = format OK, ask the chain. */
export function recipientFormatCheck(value: string, self: string): RecipientCheck | null {
  const id = value.trim();
  if (id === '') return { kind: 'empty' };
  const hint = classifyAccountId(id);
  if (hint === 'invalid') return { kind: 'invalid' };
  if (hint === 'likely_mainnet') return { kind: 'mainnet' };
  if (id === self) return { kind: 'self' };
  return null;
}

function useRecipientCheck(client: Pick<NearTestnetClient, 'readAccount'> | null, value: string, self: string): RecipientCheck {
  const id = value.trim();
  const format = recipientFormatCheck(id, self);
  const [result, setResult] = useState<{ id: string; check: RecipientCheck } | null>(null);

  useEffect(() => {
    if (format !== null || client === null) return;
    let active = true;
    const timer = setTimeout(() => {
      void client.readAccount(id).then(({ observation, error }) => {
        if (!active) return;
        const check: RecipientCheck =
          error?.code === 'ACCOUNT_NOT_FOUND'
            ? { kind: 'missing' }
            : error === null && observation.data !== null && observation.source === 'rpc'
              ? { kind: 'found' }
              : { kind: 'unchecked' };
        setResult({ id, check });
      });
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // `format` is derived from id/self.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, id, self]);

  if (format !== null) return format;
  if (client === null) return { kind: 'unchecked' };
  return result !== null && result.id === id ? result.check : { kind: 'checking' };
}

export function SendFlow({ client = getNearClient() }: { readonly client?: Pick<NearTestnetClient, 'readAccount' | 'readNativeBalance'> | null }) {
  const t = useT();
  const { state } = useWallet();
  if (state.status === 'disabled') return <InlineNotice copy={t.wallet.disabled} tone="neutral" />;
  if (state.status !== 'connected') {
    return (
      <Card className="flex flex-col gap-4 p-5">
        <p className="text-sm text-[var(--text-secondary)]">{t.walletUx.send.connectFirst}</p>
        <WalletErrorNotice />
        <ConnectWalletButton />
      </Card>
    );
  }
  return <ConnectedSend accountId={state.session.accountId} client={client} />;
}

function ConnectedSend({
  accountId,
  client,
}: {
  readonly accountId: string;
  readonly client: Pick<NearTestnetClient, 'readAccount' | 'readNativeBalance'> | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const s = t.walletUx.send;
  const recipientId = useId();
  const amountId = useId();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const check = useRecipientCheck(client, recipient, accountId);
  const contactsOn = FLAGS.contacts.enabled;
  const book = useContactBook();
  const contacts = contactsOn ? book.contacts : [];
  const balance = displayableBalance(useNativeBalance(client, accountId).view);

  let amountYocto: bigint | null = null;
  try {
    const parsed = amount.trim() === '' ? null : BigInt(toBaseUnits(amount.trim().replace(',', '.'), NEAR_NATIVE.decimals));
    amountYocto = parsed !== null && parsed > 0n ? parsed : null;
  } catch (error) {
    if (!(error instanceof InvalidAmountError)) throw error;
    amountYocto = null;
  }
  const available = balance === null ? null : BigInt(balance.balance.amountYoctoNear);
  const tooMuch = amountYocto !== null && available !== null && amountYocto + GAS_RESERVE_YOCTO > available;
  const amountError = amount.trim() !== '' && amountYocto === null ? s.amountInvalid : tooMuch ? s.insufficient : null;
  const ready = check.kind === 'found' && amountYocto !== null && !tooMuch;

  if (reviewing && ready && amountYocto !== null) {
    return (
      <div className="flex flex-col gap-4">
        <PreviewNotice />
        <SendReview
          recipientAccountId={recipient.trim()}
          amountYocto={amountYocto.toString()}
          confirm={{ available: SEND_SIGNER_AVAILABLE }}
          onEdit={() => setReviewing(false)}
          details={(() => {
            // The name is shown next to, never instead of, the full account ID above.
            const saved = contactsOn ? contactForAccount(recipient.trim(), contacts) : null;
            return saved === null ? undefined : (
              <div className="flex items-start justify-between gap-3" data-testid="review-contact">
                <dt className="shrink-0 whitespace-nowrap text-[var(--text-muted)]">{t.tools.contacts.labelField}</dt>
                <dd className="text-right">{saved.label}</dd>
              </div>
            );
          })()}
        />
      </div>
    );
  }

  const recipientMessage: Record<RecipientCheck['kind'], { text: string; tone: string } | null> = {
    empty: null,
    invalid: { text: s.recipientInvalid, tone: 'text-[var(--tone-danger-fg)]' },
    self: { text: s.recipientSelf, tone: 'text-[var(--tone-caution-fg)]' },
    mainnet: { text: s.recipientMainnet, tone: 'text-[var(--tone-danger-fg)]' },
    checking: { text: s.recipientChecking, tone: 'text-[var(--text-muted)]' },
    found: { text: s.recipientFound, tone: 'text-[var(--taply-lime)]' },
    missing: { text: s.recipientMissing, tone: 'text-[var(--tone-danger-fg)]' },
    unchecked: { text: s.recipientUnchecked, tone: 'text-[var(--tone-caution-fg)]' },
  };
  const message = recipientMessage[check.kind];

  return (
    <div className="flex flex-col gap-4">
      <PreviewNotice />
      <form
        className="surface-card flex flex-col gap-5 p-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setReviewing(true);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={recipientId} className="text-sm font-medium">
              {s.recipientLabel}
            </label>
            {contactsOn && <ContactPicker contacts={contacts} onPick={setRecipient} />}
          </div>
          <input
            id={recipientId}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={s.recipientPlaceholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="taply-input chain-id"
            aria-describedby={`${recipientId}-status`}
            aria-invalid={['invalid', 'mainnet', 'missing'].includes(check.kind) || undefined}
          />
          <p id={`${recipientId}-status`} className={`flex items-center gap-1.5 text-xs ${message?.tone ?? 'text-[var(--text-muted)]'}`} aria-live="polite">
            {check.kind === 'found' && <Icon name="check" size={14} />}
            {message?.text ?? s.recipientHint}
          </p>
          {contactsOn && <ContactMatch accountId={recipient} contacts={contacts} />}
          {contactsOn && check.kind === 'found' && contactForAccount(recipient.trim(), contacts) === null && (
            <a
              href={`/contacts?account=${encodeURIComponent(recipient.trim())}`}
              className="tap-target inline-flex items-center self-start text-xs font-medium text-[var(--text-secondary)] underline underline-offset-4"
            >
              {t.tools.contacts.saveAsContact}
            </a>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={amountId} className="text-sm font-medium">
            {s.amountLabel}
          </label>
          <div className="flex items-baseline gap-2 border-b-2 border-[var(--border-strong)] pb-2 focus-within:border-[var(--taply-lime)]">
            <input
              id={amountId}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="display-amount min-h-[64px] w-full min-w-0 bg-transparent text-[3rem] placeholder:text-[var(--text-muted)] focus-visible:outline-none"
              aria-describedby={`${amountId}-hint`}
              aria-invalid={amountError !== null || undefined}
            />
            <span aria-hidden="true" className="text-xl font-semibold text-[var(--text-secondary)]">
              NEAR
            </span>
          </div>
          <p id={`${amountId}-hint`} className={`text-xs ${amountError !== null ? 'text-[var(--tone-danger-fg)]' : 'text-[var(--text-muted)]'}`} aria-live="polite">
            {amountError ??
              (balance === null
                ? s.availableUnknown
                : fill(s.available, {
                    amount: `${formatBaseUnits(balance.balance.amountYoctoNear, NEAR_NATIVE.decimals, { locale }).display} NEAR`,
                  }))}
          </p>
        </div>

        <Button type="submit" size="lg" block disabled={!ready}>
          {s.review}
          <Icon name="arrow-right" size={18} />
        </Button>
      </form>
    </div>
  );
}

function PreviewNotice() {
  const t = useT();
  return <InlineNotice copy={t.walletUx.send.preview} tone="neutral" />;
}
