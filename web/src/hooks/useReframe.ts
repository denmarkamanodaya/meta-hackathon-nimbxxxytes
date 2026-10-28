// A short's subject tracking for 9:16 (board V19): loads its status; with Keep subject in frame
// on and nothing tracked yet, starts it once for the shown shots' subjects; polls while it runs.
import { useCallback, useEffect, useRef } from 'react';
import { isReframeRunning, shouldStartReframe } from '../core/reframe';
import type { ReframeResponse } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** How often a running track is checked, ms. */
export const REFRAME_POLL_MS = 2000;

const whileRunning = (data: ReframeResponse) => isReframeRunning(data.status);

/** The tracking status and a way to load it again. */
export interface ReframeHandle {
  state: Polled<ReframeResponse>;
  refresh: () => void;
}

/**
 * Tracks a short's subjects.
 * @param shortId - The short.
 * @param keepSubject - The finish switch; null while the finish loads (nothing starts).
 * @param subjectsKey - The shown shots' subjects joined; a change (a new subject) may start a new run.
 * @param intervalMs - Poll interval; tests shorten it.
 * @returns The handle.
 */
export function useReframe(shortId: string, keepSubject: boolean | null, subjectsKey: string, intervalMs = REFRAME_POLL_MS): ReframeHandle {
  const { api, toasts } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getReframe(shortId, signal), [api, shortId]);
  const { state, refresh } = usePolled(load, { intervalMs, keepPolling: whileRunning });
  // The subjects a run was started for, so an answer that stays idle never starts another.
  const startedFor = useRef<string | null>(null);
  const status = state.status === 'ready' ? state.data.status : null;

  useEffect(() => {
    if (keepSubject === null || status === null || !shouldStartReframe(keepSubject, status)) return;
    if (startedFor.current === subjectsKey) return;
    startedFor.current = subjectsKey;
    api.startReframe(shortId).then(refresh, (error: unknown) => {
      toasts.error('Could not start following the subjects', error);
    });
  }, [api, keepSubject, refresh, shortId, status, subjectsKey, toasts]);

  // A changed subject makes the server drop that shot's track: read the status again.
  const lastKey = useRef(subjectsKey);
  useEffect(() => {
    if (lastKey.current === subjectsKey) return;
    lastKey.current = subjectsKey;
    refresh();
  }, [subjectsKey, refresh]);

  return { state, refresh };
}
