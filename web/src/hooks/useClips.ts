// Library and clip-detail data: polled GETs, plus live ingest steps over SSE.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { isInProgress } from '../core/clip-view';
import { handoffFromClips, type EditorHandoff } from '../core/selection';
import type { ClipDetail, ClipEvent, ClipSummary } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** Library poll interval in ms. */
export const CLIPS_POLL_MS = 3000;
/** Clip detail poll interval in ms while the clip is still processing. */
export const CLIP_POLL_MS = 4000;

const keepPollingDetail = (detail: ClipDetail) => isInProgress(detail.clip.status);

/**
 * Lists the user's clips now and every 3 s (paused while the page is hidden).
 * @param intervalMs - Poll interval; tests shorten it.
 * @returns The polled list and `refresh` for pull-to-refresh.
 */
export function useClips(intervalMs: number = CLIPS_POLL_MS): {
  state: Polled<ClipSummary[]>;
  refresh: () => void;
} {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listClips(signal), [api]);
  return usePolled(load, { intervalMs });
}

/**
 * Loads one clip, polling while it is still in progress and stopping once ready or failed.
 * @param clipId - Route id.
 * @param intervalMs - Poll interval; tests shorten it.
 * @returns The polled clip detail and `refresh` (Retry).
 */
export function useClip(
  clipId: string,
  intervalMs: number = CLIP_POLL_MS,
): { state: Polled<ClipDetail>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getClip(clipId, signal), [api, clipId]);
  return usePolled(load, { intervalMs, keepPolling: keepPollingDetail });
}

/**
 * Follows a clip's ingest steps over SSE while `enabled`.
 * @param clipId - The clip.
 * @param enabled - Open the stream only for clips still in progress.
 * @returns The latest step event, or null before the first one.
 */
export function useClipEvents(clipId: string, enabled: boolean): ClipEvent | null {
  const { events } = useServices();
  const [latest, setLatest] = useState<ClipEvent | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    return events(clipId, setLatest);
  }, [events, clipId, enabled]);
  return enabled ? latest : null;
}

/**
 * "Make a short from this clip" from where only the clip's id is known (the Mac Library menu):
 * loads the clip, then opens the editor with every moment. A failure raises a toast.
 * @returns `makeShort(clipId)`.
 */
export function useMakeShortFromClip(): (clipId: string) => void {
  const fromClips = useMakeShortFromClips();
  return useCallback(
    (clipId: string) => {
      fromClips([clipId]);
    },
    [fromClips],
  );
}

/**
 * "Make a short from this project": loads every clip, then opens the editor with all their
 * moments, clip after clip. A failure raises a toast.
 * @returns `makeShort(clipIds)`.
 */
export function useMakeShortFromClips(): (clipIds: readonly string[]) => void {
  const { api, toasts } = useServices();
  const navigate = useNavigate();
  return useCallback(
    (clipIds: readonly string[]) => {
      Promise.all(clipIds.map((id) => api.getClip(id))).then(
        (details) => {
          const handoff: EditorHandoff = handoffFromClips(details);
          void navigate('/editor', { state: handoff });
        },
        (error: unknown) => {
          toasts.error(clipIds.length === 1 ? 'Could not open this clip' : 'Could not open these clips', error);
        },
      );
    },
    [api, navigate, toasts],
  );
}

/**
 * Loads several clips once (the Faces page reads when each face is on screen, and its moments,
 * from its clip). A clip that fails to load is left out.
 * @param clipIds - The clips; order and repeats do not matter.
 * @returns The details loaded so far, by clip id.
 */
export function useClipDetails(clipIds: readonly string[]): ReadonlyMap<string, ClipDetail> {
  const { api } = useServices();
  const key = [...new Set(clipIds)].sort().join('\n');
  const [details, setDetails] = useState<ReadonlyMap<string, ClipDetail>>(new Map());
  useEffect(() => {
    if (key === '') return undefined;
    const controller = new AbortController();
    void Promise.allSettled(key.split('\n').map((id) => api.getClip(id, controller.signal))).then((answers) => {
      if (controller.signal.aborted) return;
      const loaded = answers.flatMap((answer) => (answer.status === 'fulfilled' ? [answer.value] : []));
      setDetails(new Map(loaded.map((detail) => [detail.clip.clip_id, detail])));
    });
    return () => {
      controller.abort();
    };
  }, [api, key]);
  return details;
}

/**
 * Copies a speech line (the player's Speech list) and says whether it worked.
 * @returns `copy(text)`.
 */
export function useCopySpeech(): (text: string) => Promise<void> {
  const { copyText, toasts } = useServices();
  return useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) toasts.info('Line copied', '');
      else toasts.info('Could not copy', 'Select the line and copy it by hand.');
    },
    [copyText, toasts],
  );
}
