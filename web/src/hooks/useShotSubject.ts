// Changing what a shot follows ("What each shot follows", board V19). The save is
// `api.setShotSubject`, kept apart so the server's subject call can replace it in one place; today it
// saves a new draft, which the page then shows.
import { useCallback, useState } from 'react';
import { REFRAME_COPY } from '../core/copy';
import type { Timeline } from '../services/api/types';
import { useServices } from './services-context';

/** The subject edit. */
export interface ShotSubjectHandle {
  /** Saves a new subject for shot `index`; resolves the new draft's number, or null on failure. */
  save: (index: number, subject: string) => Promise<number | null>;
  /** The shot being saved, or null. */
  savingIndex: number | null;
}

/**
 * The subject edit of one draft.
 * @param shortId - The short.
 * @param timeline - The shown draft's timeline.
 * @returns The handle.
 */
export function useShotSubject(shortId: string, timeline: Timeline): ShotSubjectHandle {
  const { api, toasts } = useServices();
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const save = useCallback(
    async (index: number, subject: string) => {
      const text = subject.trim();
      const current = timeline.clips[index];
      if (current === undefined || text === '' || text === current.subject) return null;
      setSavingIndex(index);
      try {
        return (await api.setShotSubject(shortId, timeline, index, text)).version;
      } catch (error) {
        toasts.error(REFRAME_COPY.saveFailed, error);
        return null;
      } finally {
        setSavingIndex(null);
      }
    },
    [api, shortId, timeline, toasts],
  );
  return { save, savingIndex };
}
