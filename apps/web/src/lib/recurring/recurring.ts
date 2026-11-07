import { z } from 'zod';
import { InvalidAmountError, toBaseUnits } from '@/lib/format/amount';
import { normalizeLabel } from '@/lib/contacts/contacts';
import { AccountIdSchema } from '@/lib/protocol';
import { MEMO_MAX_BYTES } from '@/lib/tools/handoff';

/**
 * Recurring request TEMPLATES (E2). Not a subscription or payment engine.
 *
 *  - A template remembers amount, memo, an optional payer restriction and a
 *    schedule. Each occurrence can be turned into ONE ordinary request, only
 *    when the person opens it, reviews it and approves it in their wallet.
 *  - Nothing runs in the background. Nothing is signed, debited or sent
 *    automatically, ever. A payer is never charged by a template.
 *  - Dates are calendar dates in the template's own IANA time zone (captured
 *    when it is created), so "the 1st of the month" does not move with the
 *    device's zone or across daylight-saving changes.
 *  - Duplicate protection: an occurrence that already led to a request keeps
 *    that request ID and cannot be prepared again from the template.
 */

export const RECURRING_STORAGE_KEY = 'taply.recurring.v1';
export const MAX_TEMPLATES = 50;
export const MAX_OCCURRENCE_RECORDS = 120;
/** At most this many occurrences are ever previewed or generated at once. */
export const MAX_PREVIEW = 6;

export type Cadence = 'weekly' | 'monthly';

export interface OccurrenceRecord {
  /** Occurrence date, YYYY-MM-DD in the template's time zone. */
  readonly date: string;
  /** Request created from it (or whose outcome is still unknown). */
  readonly requestId: string;
  readonly recordedAt: string;
}

export interface Template {
  readonly id: string;
  readonly name: string;
  /** The account that will receive (creates each request). */
  readonly recipientAccountId: string;
  readonly amountBaseUnits: string;
  readonly memo: string;
  readonly payerAccountId: string | null;
  readonly cadence: Cadence;
  /** First occurrence, YYYY-MM-DD. For monthly it also fixes the day of month. */
  readonly startDate: string;
  readonly endDate: string | null;
  readonly timeZone: string;
  readonly status: 'active' | 'cancelled';
  readonly occurrences: ReadonlyArray<OccurrenceRecord>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Civil dates. All arithmetic uses UTC midnights of calendar dates, so it never
// depends on the device zone or DST; only "today" needs the template's zone.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCivilDate(value: string): boolean {
  const m = DATE.exec(value);
  if (m === null) return false;
  const [y, mo, d] = [Number.parseInt(m[1] ?? '', 10), Number.parseInt(m[2] ?? '', 10), Number.parseInt(m[3] ?? '', 10)];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return false;
  return d >= 1 && d <= daysInMonth(y, mo);
}

function parts(date: string): [number, number, number] {
  const m = DATE.exec(date);
  if (m === null) throw new Error('not a civil date');
  return [Number.parseInt(m[1] ?? '', 10), Number.parseInt(m[2] ?? '', 10), Number.parseInt(m[3] ?? '', 10)];
}

function format(y: number, mo: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(date: string, days: number): string {
  const [y, mo, d] = parts(date);
  const t = new Date(Date.UTC(y, mo - 1, d + days));
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The k-th monthly occurrence: the start's day of month, clamped to shorter months (31 -> 30 / 28 / 29). */
function addMonthsClamped(start: string, k: number): string {
  const [y, mo, d] = parts(start);
  const index = y * 12 + (mo - 1) + k;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return format(year, month, Math.min(d, daysInMonth(year, month)));
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value.length <= 64;
  } catch {
    return false;
  }
}

/** Today's calendar date in `timeZone`. */
export function civilToday(timeZone: string, now: Date): string {
  const out = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => out.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function deviceTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === 'string' && isTimeZone(zone) ? zone : 'UTC';
}

function occurrenceAt(template: Pick<Template, 'cadence' | 'startDate'>, k: number): string {
  return template.cadence === 'weekly' ? addDays(template.startDate, 7 * k) : addMonthsClamped(template.startDate, k);
}

/** Occurrences on or after `from` (and within the end date), at most `limit`. */
export function occurrencesFrom(template: Pick<Template, 'cadence' | 'startDate' | 'endDate'>, from: string, limit = MAX_PREVIEW): string[] {
  const out: string[] = [];
  const cap = Math.min(limit, MAX_PREVIEW);
  // Jump close to `from` instead of walking from the start (bounded either way).
  let k = 0;
  if (from > template.startDate) {
    const [fy, fm] = parts(from);
    const [sy, sm] = parts(template.startDate);
    k = template.cadence === 'monthly' ? Math.max(0, (fy - sy) * 12 + (fm - sm) - 1) : Math.max(0, Math.floor(daysBetween(template.startDate, from) / 7) - 1);
  }
  for (let guard = 0; out.length < cap && guard < 400; guard++, k++) {
    const date = occurrenceAt(template, k);
    if (template.endDate !== null && date > template.endDate) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/** The latest occurrence on or before `date`, or null before the start. */
export function occurrenceOnOrBefore(template: Pick<Template, 'cadence' | 'startDate' | 'endDate'>, date: string): string | null {
  if (date < template.startDate) return null;
  let last: string | null = null;
  const [dy, dm] = parts(date);
  const [sy, sm] = parts(template.startDate);
  let k = template.cadence === 'monthly' ? Math.max(0, (dy - sy) * 12 + (dm - sm) - 1) : Math.max(0, Math.floor(daysBetween(template.startDate, date) / 7) - 1);
  for (let guard = 0; guard < 400; guard++, k++) {
    const occurrence = occurrenceAt(template, k);
    if (occurrence > date || (template.endDate !== null && occurrence > template.endDate)) break;
    last = occurrence;
  }
  return last;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  // UTC midnights differ by whole days exactly; this is a day count, not money.
  return Math.trunc((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export type OccurrenceState =
  | { readonly kind: 'due'; readonly date: string }
  | { readonly kind: 'upcoming'; readonly date: string }
  | { readonly kind: 'created'; readonly date: string; readonly requestId: string }
  | { readonly kind: 'none' };

/**
 * What the template offers now: the current period's occurrence if it has no
 * request yet (due), else the next one (upcoming). Missed older periods are
 * never back-filled automatically.
 */
export function currentOccurrence(template: Template, now: Date): OccurrenceState {
  if (template.status !== 'active') return { kind: 'none' };
  const today = civilToday(template.timeZone, now);
  const record = (date: string) => template.occurrences.find((o) => o.date === date) ?? null;
  const current = occurrenceOnOrBefore(template, today);
  if (current !== null) {
    const done = record(current);
    if (done === null) return { kind: 'due', date: current };
  }
  const next = occurrencesFrom(template, addDays(today, 1), 1)[0];
  if (next === undefined) {
    const done = current === null ? null : record(current);
    return done === null ? { kind: 'none' } : { kind: 'created', date: done.date, requestId: done.requestId };
  }
  return { kind: 'upcoming', date: next };
}

// ---------------------------------------------------------------------------
// Validation and edits

export type TemplateProblem =
  | 'name_empty'
  | 'name_too_long'
  | 'name_hidden_characters'
  | 'amount_required'
  | 'amount_invalid'
  | 'amount_zero'
  | 'memo_too_long'
  | 'payer_invalid'
  | 'payer_is_recipient'
  | 'start_invalid'
  | 'end_invalid'
  | 'end_before_start'
  | 'recipient_invalid';

export interface TemplateInput {
  readonly name: string;
  /** Decimal NEAR as typed (exact; converted with BigInt). */
  readonly amount: string;
  readonly memo: string;
  readonly payer: string;
  readonly cadence: Cadence;
  readonly startDate: string;
  readonly endDate: string;
}

export function validateTemplate(
  input: TemplateInput,
  recipientAccountId: string,
): { ok: true; value: Omit<Template, 'id' | 'status' | 'occurrences' | 'createdAt' | 'updatedAt' | 'timeZone'> } | { ok: false; problems: TemplateProblem[] } {
  const problems: TemplateProblem[] = [];
  const name = normalizeLabel(input.name);
  if (!name.ok) problems.push(`name_${name.problem}`);
  let amountBaseUnits = '';
  if (input.amount.trim() === '') problems.push('amount_required');
  else {
    try {
      amountBaseUnits = toBaseUnits(input.amount.trim().replace(',', '.'), 24);
      if (amountBaseUnits === '0') problems.push('amount_zero');
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      problems.push('amount_invalid');
    }
  }
  if (new TextEncoder().encode(input.memo).length > MEMO_MAX_BYTES) problems.push('memo_too_long');
  const payer = input.payer.trim();
  if (payer !== '' && !AccountIdSchema.safeParse(payer).success) problems.push('payer_invalid');
  else if (payer !== '' && payer === recipientAccountId) problems.push('payer_is_recipient');
  if (!AccountIdSchema.safeParse(recipientAccountId).success) problems.push('recipient_invalid');
  if (!isCivilDate(input.startDate)) problems.push('start_invalid');
  const end = input.endDate.trim();
  if (end !== '' && !isCivilDate(end)) problems.push('end_invalid');
  else if (end !== '' && isCivilDate(input.startDate) && end < input.startDate) problems.push('end_before_start');
  if (problems.length > 0 || !name.ok) return { ok: false, problems };
  return {
    ok: true,
    value: {
      name: name.label,
      recipientAccountId,
      amountBaseUnits,
      memo: input.memo,
      payerAccountId: payer === '' ? null : payer,
      cadence: input.cadence,
      startDate: input.startDate,
      endDate: end === '' ? null : end,
    },
  };
}

export function createTemplate(
  input: TemplateInput,
  ctx: { readonly recipientAccountId: string; readonly timeZone: string; readonly now: Date; readonly id: string },
): { ok: true; template: Template } | { ok: false; problems: TemplateProblem[] } {
  const checked = validateTemplate(input, ctx.recipientAccountId);
  if (!checked.ok) return checked;
  const at = ctx.now.toISOString();
  return {
    ok: true,
    template: { ...checked.value, id: ctx.id, timeZone: isTimeZone(ctx.timeZone) ? ctx.timeZone : 'UTC', status: 'active', occurrences: [], createdAt: at, updatedAt: at },
  };
}

/** Edits apply to future occurrences; recorded occurrences (and their requests) are kept as they are. */
export function editTemplate(template: Template, input: TemplateInput, now: Date): { ok: true; template: Template } | { ok: false; problems: TemplateProblem[] } {
  const checked = validateTemplate(input, template.recipientAccountId);
  if (!checked.ok) return checked;
  return { ok: true, template: { ...template, ...checked.value, updatedAt: now.toISOString() } };
}

export function setTemplateStatus(template: Template, status: Template['status'], now: Date): Template {
  return { ...template, status, updatedAt: now.toISOString() };
}

/**
 * Links an occurrence to the request created from it. Refused when that
 * occurrence already has a different request (a duplicate), so one template
 * occurrence never maps to two requests.
 */
export function recordOccurrence(
  template: Template,
  date: string,
  requestId: string,
  now: Date,
): { ok: true; template: Template } | { ok: false; reason: 'already_recorded' | 'not_an_occurrence' | 'invalid_request_id' } {
  if (!/^[0-9a-f]{64}$/.test(requestId)) return { ok: false, reason: 'invalid_request_id' };
  if (!isCivilDate(date) || occurrenceOnOrBefore(template, date) !== date) return { ok: false, reason: 'not_an_occurrence' };
  const existing = template.occurrences.find((o) => o.date === date);
  if (existing !== undefined) return existing.requestId === requestId ? { ok: true, template } : { ok: false, reason: 'already_recorded' };
  const occurrences = [...template.occurrences, { date, requestId, recordedAt: now.toISOString() }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_OCCURRENCE_RECORDS);
  return { ok: true, template: { ...template, occurrences, updatedAt: now.toISOString() } };
}

// ---------------------------------------------------------------------------
// Storage

const OccurrenceSchema = z.strictObject({
  date: z.string().refine(isCivilDate),
  requestId: z.string().regex(/^[0-9a-f]{64}$/),
  recordedAt: z.iso.datetime(),
});
const TemplateSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  name: z.string().min(1).max(160),
  recipientAccountId: AccountIdSchema,
  amountBaseUnits: z.string().regex(/^[1-9][0-9]{0,38}$/),
  memo: z.string().max(1024),
  payerAccountId: AccountIdSchema.nullable(),
  cadence: z.enum(['weekly', 'monthly']),
  startDate: z.string().refine(isCivilDate),
  endDate: z.string().refine(isCivilDate).nullable(),
  timeZone: z.string().refine(isTimeZone),
  status: z.enum(['active', 'cancelled']),
  occurrences: z.array(OccurrenceSchema).max(MAX_OCCURRENCE_RECORDS),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const EnvelopeSchema = z.strictObject({ version: z.literal(1), templates: z.array(TemplateSchema).max(MAX_TEMPLATES) });

export type TemplateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type LoadedTemplates = { readonly status: 'ok'; readonly templates: Template[] } | { readonly status: 'unavailable' } | { readonly status: 'corrupt' };

export function loadTemplates(storage: TemplateStorage | null): LoadedTemplates {
  if (storage === null) return { status: 'unavailable' };
  let raw: string | null;
  try {
    raw = storage.getItem(RECURRING_STORAGE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  if (raw === null) return { status: 'ok', templates: [] };
  try {
    const parsed = EnvelopeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: 'corrupt' };
    const templates = parsed.data.templates as Template[];
    if (new Set(templates.map((t) => t.id)).size !== templates.length) return { status: 'corrupt' };
    for (const t of templates) {
      if (new Set(t.occurrences.map((o) => o.date)).size !== t.occurrences.length) return { status: 'corrupt' };
      if (new TextEncoder().encode(t.memo).length > MEMO_MAX_BYTES) return { status: 'corrupt' };
    }
    return { status: 'ok', templates };
  } catch {
    return { status: 'corrupt' };
  }
}

export function saveTemplates(storage: TemplateStorage | null, templates: ReadonlyArray<Template>): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(RECURRING_STORAGE_KEY, JSON.stringify({ version: 1, templates }));
    return true;
  } catch {
    return false;
  }
}
