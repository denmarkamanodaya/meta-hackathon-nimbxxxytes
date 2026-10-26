// App-wide toasts: short messages that dismiss themselves. A store (not React state) so any
// hook can raise one and the shell renders them above the tab bar.
import { describeError } from '../../core/error-text';

/** One toast. `code` is shown for errors so a demo viewer can tell what failed. */
export interface Toast {
  id: number;
  tone: 'error' | 'info';
  /** What the user was doing, for example "Could not save the name". */
  title: string;
  text: string;
  code: string | null;
}

/** Subscribable toast list for React's useSyncExternalStore. */
export interface ToastStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly Toast[];
  /** Shows an error toast for `error`, titled with what failed. */
  error: (title: string, error: unknown) => void;
  info: (title: string, text: string) => void;
  dismiss: (id: number) => void;
}

/** Timer the store uses; tests pass a fake. */
export type Schedule = (run: () => void, ms: number) => void;

/** How long a toast stays, in ms. */
export const TOAST_MS = 5000;
/** Most toasts on screen; older ones are dropped. */
export const MAX_TOASTS = 3;

/**
 * Creates an empty store.
 * @param schedule - Runs auto-dismiss after `TOAST_MS`.
 * @returns The store.
 */
export function createToastStore(schedule: Schedule): ToastStore {
  let toasts: readonly Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const dismiss = (id: number) => {
    if (!toasts.some((toast) => toast.id === id)) return;
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
  };
  const push = (toast: Omit<Toast, 'id'>) => {
    const id = nextId;
    nextId += 1;
    toasts = [...toasts, { ...toast, id }].slice(-MAX_TOASTS);
    emit();
    schedule(() => {
      dismiss(id);
    }, TOAST_MS);
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => toasts,
    error: (title, error) => {
      const { code, text } = describeError(error);
      push({ tone: 'error', title, text, code });
    },
    info: (title, text) => {
      push({ tone: 'info', title, text, code: null });
    },
    dismiss,
  };
}
