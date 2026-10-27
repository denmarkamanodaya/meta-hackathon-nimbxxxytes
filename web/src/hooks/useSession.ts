// Hooks for the demo session: the current lock status, and unlocking with the passcode.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../services/api/client';
import type { SessionStatus } from '../services/session/session-store';
import { useServices } from './services-context';

/**
 * Subscribes to the session status.
 * @returns `locked` after any 401, `active` after unlocking, else `unknown`.
 */
export function useSessionStatus(): SessionStatus {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/**
 * While the status is `unknown`, asks `GET /session` once. A valid cookie unlocks; a 401 locks
 * (the API client reports it). Any other failure (offline, server down) also unlocks, so the
 * cached app opens and its own error and offline states take over.
 */
export function useSessionCheck(): void {
  const { api, session } = useServices();
  const status = useSessionStatus();
  useEffect(() => {
    if (status !== 'unknown') return;
    const controller = new AbortController();
    api.getSession(controller.signal).then(
      () => {
        session.unlock();
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (!(error instanceof ApiError && error.status === 401)) session.unlock();
      },
    );
    return () => {
      controller.abort();
    };
  }, [api, session, status]);
}

/** State of the passcode form. */
export type UnlockState = { status: 'idle' | 'submitting' } | { status: 'error'; message: string };

/**
 * Submits the passcode with `POST /session`; success unlocks the app.
 * @returns The form state and the submit function.
 */
export function useUnlock(): { state: UnlockState; unlock: (passcode: string) => Promise<void> } {
  const { api, session } = useServices();
  const [state, setState] = useState<UnlockState>({ status: 'idle' });

  async function unlock(passcode: string) {
    setState({ status: 'submitting' });
    try {
      await api.createSession(passcode);
      setState({ status: 'idle' });
      session.unlock();
    } catch (error) {
      const rejected = error instanceof ApiError && (error.status === 401 || error.status === 403);
      setState({
        status: 'error',
        message: rejected ? 'That passcode did not work.' : 'Could not reach the server.',
      });
    }
  }

  return { state, unlock };
}
