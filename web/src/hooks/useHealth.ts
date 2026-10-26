// Hook that reports whether the API answers GET /health. Used by the Library header.
import { useEffect, useState } from 'react';
import { useServices } from './services-context';

/** Server reachability as the UI shows it. */
export type HealthState = 'checking' | 'online' | 'offline';

/**
 * Checks the API once on mount and cancels the request on unmount.
 * @returns `checking` until the call settles, then `online` when the server says `ok`,
 *   else `offline` (any `ApiError`, including timeout and network failure).
 */
export function useHealth(): HealthState {
  const { api } = useServices();
  const [state, setState] = useState<HealthState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    api.getHealth(controller.signal).then(
      (health) => {
        setState(health.ok ? 'online' : 'offline');
      },
      () => {
        if (!controller.signal.aborted) setState('offline');
      },
    );
    return () => {
      controller.abort();
    };
  }, [api]);

  return state;
}
