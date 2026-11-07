'use client';

import { useCallback, useEffect, useState } from 'react';
import { RECURRING_STORAGE_KEY, loadTemplates, recordOccurrence, saveTemplates } from './recurring';
import type { LoadedTemplates, Template, TemplateStorage } from './recurring';

const CHANGED_EVENT = 'taply-recurring-changed';

export function browserTemplateStorage(): TemplateStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Device-local template list; re-read on changes from this tab or another. */
export function useTemplates(storage: TemplateStorage | null = browserTemplateStorage()) {
  const [state, setState] = useState<LoadedTemplates | null>(null);

  useEffect(() => {
    const reload = () => setState(loadTemplates(storage));
    reload();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === RECURRING_STORAGE_KEY) reload();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGED_EVENT, reload);
    };
  }, [storage]);

  /** Applies `change` to the freshly stored list. Returns false when nothing could be saved. */
  const mutate = useCallback(
    (change: (list: Template[]) => Template[] | null): boolean => {
      const fresh = loadTemplates(storage);
      if (fresh.status !== 'ok') return false;
      const next = change(fresh.templates);
      if (next === null || !saveTemplates(storage, next)) return false;
      setState({ status: 'ok', templates: next });
      window.dispatchEvent(new Event(CHANGED_EVENT));
      return true;
    },
    [storage],
  );

  return { state, templates: state?.status === 'ok' ? state.templates : [], mutate };
}

/**
 * Called by the request form after a submission from a template occurrence.
 * Links the occurrence to the request ID (submitted or outcome unknown) so the
 * template cannot offer the same occurrence again. Never creates anything.
 */
export function recordTemplateOccurrence(templateId: string, date: string, requestId: string, now: Date, storage = browserTemplateStorage()): boolean {
  const fresh = loadTemplates(storage);
  if (fresh.status !== 'ok') return false;
  const index = fresh.templates.findIndex((t) => t.id === templateId);
  const template = fresh.templates[index];
  if (template === undefined) return false;
  const result = recordOccurrence(template, date, requestId, now);
  if (!result.ok) return false;
  const next = fresh.templates.map((t, i) => (i === index ? result.template : t));
  if (!saveTemplates(storage, next)) return false;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
  return true;
}
