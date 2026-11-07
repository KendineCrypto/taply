'use client';

import { loadTemplates } from '@/lib/recurring/recurring';
import { browserTemplateStorage, recordTemplateOccurrence } from '@/lib/recurring/use-templates';
import { loadSplits } from '@/lib/split/split';
import { browserSplitStorage, recordSplitChild } from '@/lib/split/use-splits';
import type { HandoffSource } from './handoff';

/** The plan a pre-filled request came from, for the form's banner. null when it no longer exists. */
export function describePrefill(source: HandoffSource): { readonly name: string; readonly detail: string } | null {
  if (source.kind === 'recurring') {
    const loaded = loadTemplates(browserTemplateStorage());
    const template = loaded.status === 'ok' ? loaded.templates.find((t) => t.id === source.id) : undefined;
    return template === undefined ? null : { name: template.name, detail: source.key };
  }
  const loaded = loadSplits(browserSplitStorage());
  const group = loaded.status === 'ok' ? loaded.groups.find((g) => g.id === source.id) : undefined;
  const person = group?.participants.find((p) => p.id === source.key);
  return group === undefined || person === undefined ? null : { name: group.name, detail: person.label };
}

/**
 * After the request form submitted (or the outcome is unknown), link the plan
 * entry to that request ID so the same occurrence / participant is never
 * offered again. Local bookkeeping only; the chain stays the authority.
 */
export function recordPrefillResult(source: HandoffSource, requestId: string, now: Date): boolean {
  return source.kind === 'recurring'
    ? recordTemplateOccurrence(source.id, source.key, requestId, now)
    : recordSplitChild(source.id, source.key, requestId, now);
}
