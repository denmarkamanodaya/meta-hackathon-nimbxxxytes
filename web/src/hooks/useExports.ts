// A short's publish pack: its exports, polled while a publish or cover run or a render is in
// flight, the run's live step from SSE, and the Publish screen's edits (caption, hashtags,
// cover pick, more covers).
import { useCallback, useEffect, useState } from 'react';
import { isLastStudioStep } from '../services/events/studio-steps';
import type { EditExportRequest, ExportsResponse, Platform, StudioStepEvent } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/**
 * Copies a post's text to the clipboard and says whether it worked.
 * @returns `copy(text)`.
 */
export function useCopyCaption(): (text: string) => Promise<void> {
  const { copyText, toasts } = useServices();
  return useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) toasts.info('Caption copied', 'Paste it when you post.');
      else toasts.info('Could not copy', 'Select the caption and copy it by hand.');
    },
    [copyText, toasts],
  );
}

/** Poll interval while anything runs, ms. */
export const EXPORTS_POLL_MS = 3000;

const isRunning = (answer: ExportsResponse) =>
  answer.busy || answer.exports.some((e) => e.status === 'queued' || e.status === 'rendering');

/** The pack and its actions. */
export interface ExportsHandle {
  state: Polled<ExportsResponse>;
  /** The run's latest step while one is in flight. */
  progress: StudioStepEvent | null;
  /** Starts captions, covers and renders for the platforms; resolves true when it started. */
  start: (platforms: Platform[]) => Promise<boolean>;
  /** Saves one platform's edit; resolves true on success (a toast says why not). */
  edit: (platform: Platform, change: EditExportRequest) => Promise<boolean>;
  /** Asks for 3 more covers for one platform. */
  moreCovers: (platform: Platform) => Promise<void>;
  refresh: () => void;
}

/**
 * Loads a short's exports.
 * @param shortId - The short.
 * @param intervalMs - Poll interval; tests shorten it.
 * @returns The handle.
 */
export function useExports(shortId: string, intervalMs: number = EXPORTS_POLL_MS): ExportsHandle {
  const { api, exportSteps, toasts } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listExports(shortId, signal), [api, shortId]);
  const { state, refresh } = usePolled(load, { intervalMs, keepPolling: isRunning });
  const [live, setLive] = useState<{ id: string; event: StudioStepEvent | null }>({ id: shortId, event: null });
  const busy = state.status === 'ready' && state.data.busy;

  useEffect(() => {
    if (!busy) return undefined;
    return exportSteps(shortId, (event) => {
      setLive({ id: shortId, event });
      if (isLastStudioStep(event)) refresh();
    });
  }, [exportSteps, shortId, busy, refresh]);

  const start = useCallback(
    async (platforms: Platform[]) => {
      try {
        await api.createExports(shortId, platforms);
        refresh();
        return true;
      } catch (error) {
        toasts.error('Could not start publishing', error);
        return false;
      }
    },
    [api, shortId, refresh, toasts],
  );

  const edit = useCallback(
    async (platform: Platform, change: EditExportRequest) => {
      try {
        await api.editExport(shortId, platform, change);
        refresh();
        return true;
      } catch (error) {
        toasts.error('Could not save the change', error);
        return false;
      }
    },
    [api, shortId, refresh, toasts],
  );

  const moreCovers = useCallback(
    async (platform: Platform) => {
      try {
        await api.moreCovers(shortId, platform);
        refresh();
      } catch (error) {
        toasts.error('Could not make more covers', error);
      }
    },
    [api, shortId, refresh, toasts],
  );

  const progress = busy && live.id === shortId ? live.event : null;
  return { state, progress, start, edit, moreCovers, refresh };
}
