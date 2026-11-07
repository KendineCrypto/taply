'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { InlineNotice } from '@/components/feedback/InlineNotice';
import { Button, ButtonLink } from '@/components/primitives/Button';
import { Card, EmptyState, ScreenHeader } from '@/components/primitives/Surface';
import { Icon } from '@/components/shell/Icons';
import { Sheet } from '@/components/shell/Sheet';
import { ConnectWalletButton } from '@/components/wallet/WalletConnect';
import { formatBaseUnits } from '@/lib/format/amount';
import { fill } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/provider';
import { NEAR_NATIVE } from '@/lib/protocol';
import {
  MAX_TEMPLATES,
  civilToday,
  createTemplate,
  currentOccurrence,
  deviceTimeZone,
  editTemplate,
  occurrencesFrom,
  setTemplateStatus,
} from '@/lib/recurring/recurring';
import type { Template, TemplateInput, TemplateProblem, TemplateStorage } from '@/lib/recurring/recurring';
import { useTemplates } from '@/lib/recurring/use-templates';
import { baseUnitsToDecimal, buildPrefillLink } from '@/lib/tools/handoff';
import { useWallet } from '@/lib/wallet/provider';

/** Calendar date shown in the person's language without shifting it by a time zone. */
export function formatCivilDate(date: string, locale: Locale): string {
  const [y, m, d] = date.split('-').map((n) => Number.parseInt(n, 10));
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

type Mode = { readonly kind: 'list' } | { readonly kind: 'add' } | { readonly kind: 'edit'; readonly template: Template };

/** `/recurring` (UX_FLOWS screen 21): templates only; no automatic charge or signature. */
export function RecurringScreen({ storage, now = () => new Date() }: { readonly storage?: TemplateStorage | null; readonly now?: () => Date }) {
  const t = useT();
  const r = t.tools.recurring;
  const { locale } = useLocale();
  const { state: wallet } = useWallet();
  const store = useTemplates(storage === undefined ? undefined : storage);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const account = wallet.status === 'connected' ? wallet.session.accountId : null;

  const header = (
    <>
      <ScreenHeader title={r.title} description={r.description} />
      <p className="mb-4 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-sm text-[var(--text-secondary)]" data-testid="not-subscription">
        <Icon name="shield" size={16} className="mr-1.5 inline" /> {r.notSubscription}
      </p>
    </>
  );
  const state = store.state;
  if (state === null) return header;
  if (state.status !== 'ok') {
    return (
      <>
        {header}
        <InlineNotice copy={state.status === 'unavailable' ? r.unavailable : r.corrupt} tone={state.status === 'unavailable' ? 'caution' : 'danger'} />
      </>
    );
  }

  if (mode.kind !== 'list') {
    if (account === null) {
      // The wallet disconnected while the form was open: nothing to save it for.
      return (
        <>
          {header}
          <Card className="flex flex-col gap-3 p-5">
            <p className="text-sm text-[var(--text-secondary)]">{r.connectFirst}</p>
            <ConnectWalletButton />
          </Card>
        </>
      );
    }
    const editing = mode.kind === 'edit' ? mode.template : null;
    return (
      <>
        <ScreenHeader title={editing === null ? r.addTitle : r.editTitle} />
        <Card className="p-5">
          <TemplateForm
            key={editing?.id ?? 'new'}
            editing={editing}
            recipient={editing?.recipientAccountId ?? account}
            timeZone={editing?.timeZone ?? deviceTimeZone()}
            today={civilToday(editing?.timeZone ?? deviceTimeZone(), now())}
            onCancel={() => setMode({ kind: 'list' })}
            onSave={(input) => {
              const result =
                editing === null
                  ? createTemplate(input, { recipientAccountId: account, timeZone: deviceTimeZone(), now: now(), id: crypto.randomUUID() })
                  : editTemplate(editing, input, now());
              if (!result.ok) return result.problems;
              const saved = store.mutate((list) =>
                editing === null
                  ? list.length >= MAX_TEMPLATES
                    ? null
                    : [...list, result.template]
                  : list.some((x) => x.id === editing.id)
                    ? list.map((x) => (x.id === editing.id ? result.template : x))
                    : null,
              );
              if (!saved) return ['save_failed'];
              setMode({ kind: 'list' });
              setNotice(r.saved);
              return [];
            }}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        {account === null ? (
          <Card className="flex flex-col gap-3 p-5">
            <p className="text-sm text-[var(--text-secondary)]">{r.connectFirst}</p>
            <ConnectWalletButton />
          </Card>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setMode({ kind: 'add' })} disabled={store.templates.length >= MAX_TEMPLATES}>
              <Icon name="clock" size={16} /> {r.add}
            </Button>
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {notice ?? ''}
        </p>
        {notice !== null && <p className="px-1 text-sm text-[var(--text-secondary)]">{notice}</p>}
        {store.templates.length === 0 ? (
          <EmptyState title={r.empty.title} body={r.empty.body} />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="template-list">
            {store.templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                account={account}
                now={now()}
                locale={locale}
                onEdit={() => setMode({ kind: 'edit', template })}
                onDelete={() => setDeleting(template)}
                onToggle={() => {
                  store.mutate((list) =>
                    list.map((x) => (x.id === template.id ? setTemplateStatus(x, x.status === 'active' ? 'cancelled' : 'active', now()) : x)),
                  );
                }}
              />
            ))}
          </ul>
        )}
        <p className="text-xs text-[var(--text-muted)]">{t.app.demoFundsNote}</p>
      </div>
      <Sheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={r.deleteTitle}
        description={deleting === null ? '' : fill(r.deleteBody, { name: deleting.name })}
        closeLabel={r.cancel}
      >
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            block
            onClick={() => {
              if (deleting !== null) store.mutate((list) => list.filter((x) => x.id !== deleting.id));
              setDeleting(null);
            }}
          >
            {r.deleteConfirm}
          </Button>
          <Button variant="ghost" size="lg" block onClick={() => setDeleting(null)}>
            {r.cancel}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function TemplateCard({
  template,
  account,
  now,
  locale,
  onEdit,
  onDelete,
  onToggle,
}: {
  readonly template: Template;
  readonly account: string | null;
  readonly now: Date;
  readonly locale: Locale;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onToggle: () => void;
}) {
  const t = useT();
  const r = t.tools.recurring;
  const current = currentOccurrence(template, now);
  const preview = template.status === 'active' ? occurrencesFrom(template, civilToday(template.timeZone, now), 3) : [];
  const amount = `${formatBaseUnits(template.amountBaseUnits, NEAR_NATIVE.decimals, { locale }).exact} NEAR`;
  const mine = account === template.recipientAccountId;
  const statusText =
    template.status !== 'active'
      ? r.stopped
      : current.kind === 'due'
        ? fill(r.due, { date: formatCivilDate(current.date, locale) })
        : current.kind === 'upcoming'
          ? fill(r.upcoming, { date: formatCivilDate(current.date, locale) })
          : current.kind === 'created'
            ? fill(r.created, { date: formatCivilDate(current.date, locale) })
            : r.none;
  return (
    <li className="surface-card flex flex-col gap-3 p-4" data-testid="template-card" data-status={template.status} data-occurrence={current.kind}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{template.name}</p>
          <p className="text-sm text-[var(--text-secondary)]">
            {amount} · {r.cadence[template.cadence]}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
            current.kind === 'due' ? 'border-[var(--tone-caution-border)] text-[var(--tone-caution-fg)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
          }`}
        >
          {statusText}
        </span>
      </div>
      <dl className="grid gap-1 text-xs text-[var(--text-secondary)]">
        <dd className="chain-id break-all">{fill(r.toYou, { account: template.recipientAccountId })}</dd>
        <dd className="chain-id break-all">{template.payerAccountId === null ? r.anyPayer : fill(r.onlyPayer, { account: template.payerAccountId })}</dd>
        {template.memo !== '' && <dd className="whitespace-pre-wrap break-words">“{template.memo}”</dd>}
        <dd>{fill(r.timeZone, { zone: template.timeZone })}</dd>
      </dl>
      {preview.length > 0 && (
        <div>
          <p className="eyebrow text-[var(--text-muted)]">{r.nextDates}</p>
          <ol className="mt-1 flex flex-wrap gap-1.5 text-xs" data-testid="template-preview">
            {preview.map((date) => (
              <li key={date} className="rounded-full bg-[var(--surface-2)] px-2 py-0.5">
                {formatCivilDate(date, locale)}
              </li>
            ))}
          </ol>
        </div>
      )}
      {current.kind === 'due' && template.status === 'active' && (
        <div className="flex flex-col gap-1.5">
          {mine ? (
            <ButtonLink
              href={buildPrefillLink({
                amountBaseUnits: template.amountBaseUnits,
                memo: template.memo,
                payer: template.payerAccountId,
                source: { kind: 'recurring', id: template.id, key: current.date },
              })}
              variant="primary"
              size="lg"
              block
            >
              {fill(r.prepare, { date: formatCivilDate(current.date, locale) })}
            </ButtonLink>
          ) : (
            <p className="text-sm text-[var(--tone-caution-fg)]">{fill(r.otherAccount, { account: template.recipientAccountId })}</p>
          )}
          <p className="text-xs text-[var(--text-muted)]">{r.prepareNote}</p>
        </div>
      )}
      {template.occurrences.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {template.occurrences.slice(-3).reverse().map((o) => (
            <li key={o.date} className="flex items-center justify-between gap-2">
              <span>{fill(r.created, { date: formatCivilDate(o.date, locale) })}</span>
              <Link href={`/pay/${o.requestId}` as never} className="tap-target inline-flex items-center font-medium underline underline-offset-4">
                {r.openRequest}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onEdit} aria-label={`${r.edit}: ${template.name}`}>
          {r.edit}
        </Button>
        <Button variant="secondary" onClick={onToggle} aria-label={`${template.status === 'active' ? r.stop : r.resume}: ${template.name}`}>
          {template.status === 'active' ? r.stop : r.resume}
        </Button>
        <Button variant="ghost" onClick={onDelete} aria-label={`${r.delete}: ${template.name}`}>
          {r.delete}
        </Button>
      </div>
    </li>
  );
}

function TemplateForm({
  editing,
  recipient,
  timeZone,
  today,
  onSave,
  onCancel,
}: {
  readonly editing: Template | null;
  readonly recipient: string;
  readonly timeZone: string;
  readonly today: string;
  readonly onSave: (input: TemplateInput) => ReadonlyArray<TemplateProblem | 'save_failed'>;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const r = t.tools.recurring;
  const base = useId();
  const [input, setInput] = useState<TemplateInput>(() => ({
    name: editing?.name ?? '',
    amount: editing === null ? '' : baseUnitsToDecimal(editing.amountBaseUnits, NEAR_NATIVE.decimals),
    memo: editing?.memo ?? '',
    payer: editing?.payerAccountId ?? '',
    cadence: editing?.cadence ?? 'monthly',
    startDate: editing?.startDate ?? today,
    endDate: editing?.endDate ?? '',
  }));
  const [problems, setProblems] = useState<ReadonlyArray<TemplateProblem | 'save_failed'>>([]);
  const set = (key: keyof TemplateInput) => (value: string) => setInput((prev) => ({ ...prev, [key]: value }));
  const errorFor = (prefix: string) => problems.find((p) => p.startsWith(prefix));
  const field = (key: keyof TemplateInput, label: string, prefix: string, props: Record<string, unknown> = {}, hint?: string) => {
    const id = `${base}-${key}`;
    const error = errorFor(prefix);
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <input
          id={id}
          value={input[key]}
          onChange={(e) => set(key)(e.target.value)}
          className="taply-input"
          autoComplete="off"
          aria-invalid={error !== undefined || undefined}
          aria-describedby={`${id}-hint`}
          {...props}
        />
        <p id={`${id}-hint`} className={`text-xs ${error ? 'text-[var(--tone-danger-fg)]' : 'text-[var(--text-muted)]'}`} aria-live="polite">
          {error !== undefined ? r.errors[error] : (hint ?? '')}
        </p>
      </div>
    );
  };
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setProblems(onSave(input));
      }}
    >
      <p className="chain-id break-all text-sm text-[var(--text-secondary)]">{fill(r.toYou, { account: recipient })}</p>
      {field('name', r.nameField, 'name_', { maxLength: 80 })}
      {field('amount', r.amountField, 'amount_', { inputMode: 'decimal', placeholder: '0' })}
      {field('memo', r.memoField, 'memo_')}
      {field('payer', r.payerField, 'payer_', { autoCapitalize: 'none', spellCheck: false, className: 'taply-input chain-id' }, r.payerHint)}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{r.cadenceField}</legend>
        <div className="flex gap-2">
          {(['monthly', 'weekly'] as const).map((c) => (
            <label key={c} className="tap-target flex flex-1 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] px-3">
              <input type="radio" name={`${base}-cadence`} checked={input.cadence === c} onChange={() => set('cadence')(c)} />
              {r.cadence[c]}
            </label>
          ))}
        </div>
      </fieldset>
      {field('startDate', r.startField, 'start_', { type: 'date' }, r.startHint)}
      {field('endDate', r.endField, 'end_', { type: 'date' }, r.endHint)}
      <p className="text-xs text-[var(--text-muted)]">{fill(r.timeZone, { zone: timeZone })}</p>
      {problems.includes('save_failed') && (
        <p role="alert" className="text-sm text-[var(--tone-danger-fg)]">
          {r.errors.save_failed}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" size="lg" block>
          {r.save}
        </Button>
        <Button type="button" variant="ghost" size="lg" block onClick={onCancel}>
          {r.cancel}
        </Button>
      </div>
    </form>
  );
}
