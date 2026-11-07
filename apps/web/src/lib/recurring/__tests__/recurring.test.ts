import { describe, expect, it } from 'vitest';
import {
  RECURRING_STORAGE_KEY,
  civilToday,
  createTemplate,
  currentOccurrence,
  editTemplate,
  isCivilDate,
  loadTemplates,
  occurrenceOnOrBefore,
  occurrencesFrom,
  recordOccurrence,
  saveTemplates,
  setTemplateStatus,
} from '../recurring';
import type { Template, TemplateInput } from '../recurring';
import { baseUnitsToDecimal, buildPrefillLink, parsePrefill } from '@/lib/tools/handoff';

const ME = 'landlord.testnet';
const NOW = new Date('2026-11-08T09:00:00.000Z');
const REQ = (n: number) => n.toString(16).padStart(64, '0');

function input(over: Partial<TemplateInput> = {}): TemplateInput {
  return { name: 'Rent', amount: '1.5', memo: 'Flat 3', payer: '', cadence: 'monthly', startDate: '2026-11-01', endDate: '', ...over };
}

function make(over: Partial<TemplateInput> = {}, timeZone = 'Europe/Istanbul'): Template {
  const r = createTemplate(input(over), { recipientAccountId: ME, timeZone, now: NOW, id: 'template-0001' });
  if (!r.ok) throw new Error(r.problems.join(','));
  return r.template;
}

describe('calendar arithmetic', () => {
  it('validates civil dates, including leap days', () => {
    expect(isCivilDate('2028-02-29')).toBe(true);
    expect(isCivilDate('2027-02-29')).toBe(false);
    expect(isCivilDate('2026-13-01')).toBe(false);
    expect(isCivilDate('26-11-01')).toBe(false);
  });

  it('monthly on the 31st clamps to shorter months and returns to 31 (no drift)', () => {
    const t = make({ startDate: '2027-01-31' });
    expect(occurrencesFrom(t, '2027-01-01', 6)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
    const leap = make({ startDate: '2028-01-31' });
    expect(occurrencesFrom(leap, '2028-02-01', 1)).toEqual(['2028-02-29']);
  });

  it('weekly steps 7 calendar days across year end and DST changes', () => {
    const t = make({ cadence: 'weekly', startDate: '2026-10-22' }, 'Europe/Berlin'); // DST ends 2026-10-25 in Berlin
    expect(occurrencesFrom(t, '2026-10-22', 4)).toEqual(['2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12']);
    const ny = make({ cadence: 'weekly', startDate: '2026-12-24' });
    expect(occurrencesFrom(ny, '2026-12-25', 2)).toEqual(['2026-12-31', '2027-01-07']);
  });

  it('honours the end date and caps the preview', () => {
    const t = make({ startDate: '2026-11-01', endDate: '2027-01-15' });
    expect(occurrencesFrom(t, '2026-11-01', 6)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(occurrencesFrom(make(), '2026-11-01', 50)).toHaveLength(6);
  });

  it('jumps far ahead without walking every period', () => {
    const t = make({ startDate: '2026-11-01' });
    expect(occurrencesFrom(t, '2035-06-02', 1)).toEqual(['2035-07-01']);
    expect(occurrenceOnOrBefore(t, '2035-06-02')).toBe('2035-06-01');
  });

  it("'today' is the template's zone, not the device's (date line test)", () => {
    const instant = new Date('2026-11-30T23:30:00.000Z');
    expect(civilToday('UTC', instant)).toBe('2026-11-30');
    expect(civilToday('Pacific/Kiritimati', instant)).toBe('2026-12-01'); // UTC+14
    expect(civilToday('Pacific/Pago_Pago', instant)).toBe('2026-11-30'); // UTC-11
    expect(civilToday('Europe/Istanbul', instant)).toBe('2026-12-01'); // UTC+3
  });
});

describe('current occurrence', () => {
  it('is due on its day in the template zone, then moves to the next one only after a request exists', () => {
    const t = make({ startDate: '2026-12-01' }, 'Europe/Istanbul');
    const evening = new Date('2026-11-30T21:30:00.000Z'); // 00:30 on Dec 1 in Istanbul
    expect(currentOccurrence(t, evening)).toEqual({ kind: 'due', date: '2026-12-01' });
    expect(currentOccurrence(make({ startDate: '2026-12-01' }, 'UTC'), evening)).toEqual({ kind: 'upcoming', date: '2026-12-01' });

    const done = recordOccurrence(t, '2026-12-01', REQ(1), evening);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(currentOccurrence(done.template, evening)).toEqual({ kind: 'upcoming', date: '2027-01-01' });
  });

  it('does not back-fill missed periods; it offers only the current one', () => {
    const t = make({ startDate: '2026-01-15' });
    expect(currentOccurrence(t, NOW)).toEqual({ kind: 'due', date: '2026-10-15' });
  });

  it('a cancelled template offers nothing, and resuming restores it', () => {
    const t = setTemplateStatus(make(), 'cancelled', NOW);
    expect(currentOccurrence(t, NOW)).toEqual({ kind: 'none' });
    expect(currentOccurrence(setTemplateStatus(t, 'active', NOW), NOW).kind).toBe('due');
  });

  it('after the last occurrence has a request, it shows that request', () => {
    const t = make({ startDate: '2026-11-01', endDate: '2026-11-30' });
    const r = recordOccurrence(t, '2026-11-01', REQ(9), NOW);
    expect(r.ok && currentOccurrence(r.template, NOW)).toEqual({ kind: 'created', date: '2026-11-01', requestId: REQ(9) });
  });
});

describe('duplicate protection (T23)', () => {
  it('one occurrence maps to exactly one request', () => {
    const t = make();
    const first = recordOccurrence(t, '2026-11-01', REQ(1), NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(recordOccurrence(first.template, '2026-11-01', REQ(1), NOW)).toMatchObject({ ok: true });
    expect(recordOccurrence(first.template, '2026-11-01', REQ(2), NOW)).toEqual({ ok: false, reason: 'already_recorded' });
  });

  it('refuses dates that are not occurrences and malformed request IDs', () => {
    const t = make();
    expect(recordOccurrence(t, '2026-11-02', REQ(1), NOW)).toEqual({ ok: false, reason: 'not_an_occurrence' });
    expect(recordOccurrence(t, '2026-11-01', 'abc', NOW)).toEqual({ ok: false, reason: 'invalid_request_id' });
  });

  it('editing keeps recorded occurrences and only changes future terms', () => {
    const t = make();
    const r = recordOccurrence(t, '2026-11-01', REQ(1), NOW);
    if (!r.ok) throw new Error('record');
    const edited = editTemplate(r.template, input({ amount: '2' }), NOW);
    expect(edited.ok && edited.template.occurrences).toEqual(r.template.occurrences);
    expect(edited.ok && edited.template.amountBaseUnits).toBe('2000000000000000000000000');
  });
});

describe('validation', () => {
  it('converts amounts exactly (no floating point)', () => {
    expect(make({ amount: '0.000000000000000000000001' }).amountBaseUnits).toBe('1');
    expect(make({ amount: '1,25' }).amountBaseUnits).toBe('1250000000000000000000000');
  });

  it.each([
    [{ name: '' }, 'name_empty'],
    [{ name: 'R\u202Eent' }, 'name_hidden_characters'],
    [{ amount: '' }, 'amount_required'],
    [{ amount: '0' }, 'amount_zero'],
    [{ amount: '1e3' }, 'amount_invalid'],
    [{ amount: '0.0000000000000000000000001' }, 'amount_invalid'],
    [{ memo: 'x'.repeat(257) }, 'memo_too_long'],
    [{ payer: 'Bad!' }, 'payer_invalid'],
    [{ payer: ME }, 'payer_is_recipient'],
    [{ startDate: '2026-02-30' }, 'start_invalid'],
    [{ endDate: '2026-10-01' }, 'end_before_start'],
  ])('refuses %j', (over, problem) => {
    const r = createTemplate(input(over), { recipientAccountId: ME, timeZone: 'UTC', now: NOW, id: 'template-0002' });
    expect(r.ok === false && r.problems).toContain(problem);
  });

  it('an unknown time zone falls back to UTC rather than throwing later', () => {
    expect(make({}, 'Mars/Olympus').timeZone).toBe('UTC');
  });
});

describe('storage', () => {
  function memory() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  }

  it('round-trips', () => {
    const s = memory();
    const t = make();
    expect(saveTemplates(s, [t])).toBe(true);
    expect(loadTemplates(s)).toEqual({ status: 'ok', templates: [t] });
  });

  it.each([
    ['not JSON', '{'],
    ['unknown field (no hidden autopay flag)', JSON.stringify({ version: 1, templates: [{ ...make(), autoPay: true }] })],
    ['bad amount', JSON.stringify({ version: 1, templates: [{ ...make(), amountBaseUnits: '1.5' }] })],
    ['duplicate occurrence', JSON.stringify({ version: 1, templates: [{ ...make(), occurrences: [{ date: '2026-11-01', requestId: REQ(1), recordedAt: NOW.toISOString() }, { date: '2026-11-01', requestId: REQ(2), recordedAt: NOW.toISOString() }] }] })],
  ])('reports %s as corrupt and keeps it', (_n, raw) => {
    const s = memory();
    s.setItem(RECURRING_STORAGE_KEY, raw);
    expect(loadTemplates(s)).toEqual({ status: 'corrupt' });
    expect(s.getItem(RECURRING_STORAGE_KEY)).toBe(raw);
  });
});

describe('hand-off to the request form', () => {
  it('builds an exact, strictly parsed pre-fill link', () => {
    const link = buildPrefillLink({ amountBaseUnits: '1500000000000000000000000', memo: 'Rent · Kasım', payer: 'tenant.testnet', source: { kind: 'recurring', id: 'template-0001', key: '2026-12-01' } });
    const parsed = parsePrefill(link.slice(link.indexOf('?')));
    expect(parsed).toEqual({ amountBaseUnits: '1500000000000000000000000', memo: 'Rent · Kasım', payer: 'tenant.testnet', source: { kind: 'recurring', id: 'template-0001', key: '2026-12-01' } });
    expect(baseUnitsToDecimal('1500000000000000000000000', 24)).toBe('1.5');
    expect(baseUnitsToDecimal('1', 24)).toBe('0.000000000000000000000001');
    expect(baseUnitsToDecimal('100000000000000000000000000', 24)).toBe('100');
  });

  it.each([
    '?amountYocto=0&from=recurring:template-0001:2026-12-01',
    '?amountYocto=1.5&from=recurring:template-0001:2026-12-01',
    '?amountYocto=1&from=evil:template-0001:x',
    '?amountYocto=1&from=recurring:<script>:x',
    `?amountYocto=1&memo=${'x'.repeat(257)}&from=recurring:template-0001:2026-12-01`,
    '?amountYocto=1&payer=Not%20Valid&from=recurring:template-0001:2026-12-01',
    `?amountYocto=${(1n << 128n).toString()}&from=recurring:template-0001:2026-12-01`,
    '?amountYocto=1',
  ])('refuses %s', (search) => {
    expect(parsePrefill(search)).toBeNull();
  });
});
