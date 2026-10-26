// Optimistic edits over server rows: show the change at once, keep the server's answer on
// success, and put the previous value back on failure.
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyPatches } from '../core/patches';

/** What `useOptimisticPatches` hands the caller. */
export interface OptimisticPatches<T> {
  /** Lays the current patches over `rows`. */
  apply: (rows: readonly T[]) => T[];
  /**
   * Shows `optimistic` for row `id` now, then runs `save`.
   * Resolves true on success (the saved row replaces the patch), false after a revert.
   */
  commit: (id: string, optimistic: Partial<T>, save: () => Promise<T>) => Promise<boolean>;
  /** Message of the last failed save, cleared by the next commit. */
  error: string | null;
}

/**
 * Optimistic patch state for one list of rows.
 * @param idOf - Reads a row's id; must be stable.
 * @returns See `OptimisticPatches`.
 */
export function useOptimisticPatches<T>(idOf: (row: T) => string): OptimisticPatches<T> {
  const [patches, setPatches] = useState<ReadonlyMap<string, Partial<T>>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(patches);
  useEffect(() => {
    latest.current = patches;
  }, [patches]);

  const setPatch = useCallback((id: string, patch: Partial<T> | undefined) => {
    setPatches((current) => {
      const next = new Map(current);
      if (patch === undefined) next.delete(id);
      else next.set(id, patch);
      return next;
    });
  }, []);

  const commit = useCallback(
    async (id: string, optimistic: Partial<T>, save: () => Promise<T>) => {
      const previous = latest.current.get(id);
      setError(null);
      setPatch(id, { ...previous, ...optimistic });
      try {
        setPatch(id, await save());
        return true;
      } catch (thrown) {
        setPatch(id, previous);
        setError(thrown instanceof Error ? thrown.message : 'Could not save');
        return false;
      }
    },
    [setPatch],
  );

  const apply = useCallback((rows: readonly T[]) => applyPatches(rows, patches, idOf), [patches, idOf]);
  return { apply, commit, error };
}
