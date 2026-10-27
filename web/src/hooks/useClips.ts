// Library and clip-detail data: polled GETs, plus live ingest steps over SSE.
import { useCallback, useEffect, useState } from 'react';
import { isInProgress } from '../core/clip-view';
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

/** Where a remove request is. */
export type RemoveState = 'idle' | 'removing' | 'error';

/**
 * Removes a clip (`DELETE /clips/{id}`): only ever called from the owner's confirm tap.
 * Failures raise a toast and leave the clip in place.
 * @returns `remove(clipId)`, resolving true once the clip is gone, and its state.
 */
export function useRemoveClip(): { remove: (clipId: string) => Promise<boolean>; state: RemoveState } {
  const { api, toasts } = useServices();
  const [state, setState] = useState<RemoveState>('idle');
  const remove = useCallback(
    async (clipId: string) => {
      setState('removing');
      try {
        await api.deleteClip(clipId);
        setState('idle');
        return true;
      } catch (error) {
        setState('error');
        toasts.error('Could not remove this copy', error);
        return false;
      }
    },
    [api, toasts],
  );
  return { remove, state };
}
