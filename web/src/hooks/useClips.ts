// Hook that polls GET /clips so the Library shows status changes (uploaded → processing → ready)
// without a reload. Polls again only after the previous call settles, so calls never pile up.
import { useEffect, useState } from 'react';
import type { ClipSummary } from '../services/api/types';
import { useServices } from './services-context';

/** Library data as the UI shows it. `stale` = last poll failed, showing older data. */
export type ClipsState =
  | { status: 'loading' }
  | { status: 'ready'; clips: ClipSummary[]; stale: boolean }
  | { status: 'error'; message: string };

/** Default poll interval in ms. */
export const CLIPS_POLL_MS = 3000;

/**
 * Lists the user's clips now and every `intervalMs` until unmount.
 * @param intervalMs - Delay between the end of one call and the start of the next.
 * @returns Loading, the latest clips, or the error when no clips were ever loaded.
 */
export function useClips(intervalMs: number = CLIPS_POLL_MS): ClipsState {
  const { api } = useServices();
  const [state, setState] = useState<ClipsState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      void api
        .listClips(controller.signal)
        .then(
          (clips) => {
            setState({ status: 'ready', clips, stale: false });
          },
          (error: unknown) => {
            if (controller.signal.aborted) return;
            const message = error instanceof Error ? error.message : 'Could not load clips';
            setState((prev) =>
              prev.status === 'ready' ? { ...prev, stale: true } : { status: 'error', message },
            );
          },
        )
        .finally(() => {
          if (!controller.signal.aborted) timer = setTimeout(poll, intervalMs);
        });
    };
    poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, intervalMs]);

  return state;
}
