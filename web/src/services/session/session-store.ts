// Demo session state. The API client reports every 401 here; the shell then shows the passcode
// screen instead of the page. `unknown` (no call made yet) is treated like unlocked.

/** Whether the app may call authenticated endpoints. */
export type SessionStatus = 'unknown' | 'active' | 'locked';

/** Subscribable session status for React's useSyncExternalStore. */
export interface SessionStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SessionStatus;
  /** A call came back 401: ask for the passcode. */
  lock: () => void;
  /** `POST /session` succeeded. */
  unlock: () => void;
}

/**
 * Creates the session store in `unknown`.
 * @returns The store.
 */
export function createSessionStore(): SessionStore {
  let status: SessionStatus = 'unknown';
  const listeners = new Set<() => void>();
  const set = (next: SessionStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => status,
    lock: () => {
      set('locked');
    },
    unlock: () => {
      set('active');
    },
  };
}
