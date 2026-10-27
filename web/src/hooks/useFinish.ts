// A short's finish settings (privacy blur, titles, effect): loaded once, each change saved at
// once and shown before the server answers; a failed save toasts and shows the saved value again.
import { useCallback, useState } from 'react';
import type { ShortFinish } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

const once = () => false;

/** The finish and its save action. */
export interface FinishHandle {
  state: Polled<ShortFinish>;
  /** What the screen shows: the pending change, else the saved finish. */
  finish: ShortFinish | null;
  /** Saves a change to the finish. */
  update: (change: Partial<ShortFinish>) => Promise<void>;
  isSaving: boolean;
}

/**
 * Loads a short's finish.
 * @param shortId - The short.
 * @returns The handle.
 */
export function useFinish(shortId: string): FinishHandle {
  const { api, toasts } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getFinish(shortId, signal), [api, shortId]);
  const { state } = usePolled(load, { intervalMs: 60_000, keepPolling: once });
  const [shown, setShown] = useState<ShortFinish | null>(null);
  const [isSaving, setSaving] = useState(false);
  const saved = state.status === 'ready' ? state.data : null;
  const finish = shown ?? saved;

  const update = useCallback(
    async (change: Partial<ShortFinish>) => {
      if (finish === null) return;
      const next = { ...finish, ...change };
      setShown(next);
      setSaving(true);
      try {
        setShown(await api.saveFinish(shortId, next));
      } catch (error) {
        setShown(finish);
        toasts.error('Could not save the finish', error);
      } finally {
        setSaving(false);
      }
    },
    [api, finish, shortId, toasts],
  );

  return { state, finish, update, isSaving };
}
