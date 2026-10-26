// Generic polling for a GET resource: loads now, then again `intervalMs` after each call
// settles, so calls never pile up. Pauses while the page is hidden and catches up on return.
import { useCallback, useEffect, useRef, useState } from 'react';

/** A polled resource as the UI shows it. `stale` = the last poll failed, data is older. */
export type Polled<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T; stale: boolean }
  | { status: 'error'; message: string };

/** Options for `usePolled`. */
export interface PollOptions<T> {
  /** Delay between the end of one call and the start of the next, in ms. */
  intervalMs: number;
  /** Return false to stop polling after this result (for example once a clip is ready). */
  keepPolling?: (data: T) => boolean;
}

const always = () => true;

/**
 * Polls `load` until unmount or until `keepPolling` says stop.
 * @param load - Fetches the resource; must be stable (wrap it in useCallback).
 * @param options - Interval and stop rule; `keepPolling` must be stable too.
 * @returns The state and `refresh`, which loads now (pull-to-refresh) and resumes polling.
 */
export function usePolled<T>(
  load: (signal: AbortSignal) => Promise<T>,
  { intervalMs, keepPolling = always }: PollOptions<T>,
): { state: Polled<T>; refresh: () => void } {
  const [state, setState] = useState<Polled<T>>({ status: 'loading' });
  const tickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let waitingForVisible = false;

    const tick = () => {
      clearTimeout(timer);
      if (inFlight || controller.signal.aborted) return;
      if (document.visibilityState === 'hidden') {
        waitingForVisible = true;
        return;
      }
      inFlight = true;
      let isDone = false;
      void load(controller.signal)
        .then(
          (data) => {
            setState({ status: 'ready', data, stale: false });
            isDone = !keepPolling(data);
          },
          (error: unknown) => {
            if (controller.signal.aborted) return;
            const message = error instanceof Error ? error.message : 'Could not load';
            setState((prev) =>
              prev.status === 'ready' ? { ...prev, stale: true } : { status: 'error', message },
            );
          },
        )
        .finally(() => {
          inFlight = false;
          if (!controller.signal.aborted && !isDone) timer = setTimeout(tick, intervalMs);
        });
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !waitingForVisible) return;
      waitingForVisible = false;
      tick();
    };

    tickRef.current = tick;
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, intervalMs, keepPolling]);

  const refresh = useCallback(() => {
    tickRef.current();
  }, []);
  return { state, refresh };
}
