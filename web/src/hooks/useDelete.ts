// Deleting clips and shorts, only ever from the owner's tap on a confirm sheet or dialog. Clips go
// one at a time (the Mac Library deletes several), and the result comes back for the caller's
// toast; one short toasts here.
import { useCallback, useState } from 'react';
import { deleteInOrder, type DeleteOutcome } from '../core/bulk-delete';
import { useServices } from './services-context';

/** A delete action and whether it runs. */
export interface DeleteRun {
  /** Deletes the ids in order; resolves what went and what stayed (never rejects). */
  run: (ids: readonly string[]) => Promise<DeleteOutcome>;
  isDeleting: boolean;
}

function useDeleteRun(remove: (id: string) => Promise<unknown>): DeleteRun {
  const [isDeleting, setDeleting] = useState(false);
  const run = useCallback(
    async (ids: readonly string[]) => {
      setDeleting(true);
      try {
        return await deleteInOrder(ids, remove);
      } finally {
        setDeleting(false);
      }
    },
    [remove],
  );
  return { run, isDeleting };
}

/**
 * Deletes clips (`DELETE /clips/{id}`).
 * @returns The run.
 */
export function useDeleteClips(): DeleteRun {
  const { api } = useServices();
  return useDeleteRun(useCallback((id: string) => api.deleteClip(id), [api]));
}

/**
 * Deletes shorts (`DELETE /shorts/{id}`).
 * @returns The run.
 */
export function useDeleteShorts(): DeleteRun {
  const { api } = useServices();
  return useDeleteRun(useCallback((id: string) => api.deleteShort(id), [api]));
}

/** A one-item delete behind a confirm: toasts how it went, resolves true once the item is gone. */
export interface DeleteOne<T> {
  remove: (target: T) => Promise<boolean>;
  isDeleting: boolean;
}

/**
 * Deletes one short from its confirm sheet or dialog ("Short deleted", or why not).
 * @returns The delete.
 */
export function useDeleteShort(): DeleteOne<string> {
  const { toasts } = useServices();
  const { run, isDeleting } = useDeleteShorts();
  const remove = useCallback(
    async (shortId: string) => {
      const outcome = await run([shortId]);
      if (outcome.failed.length > 0) {
        toasts.error('Could not delete the short', outcome.firstError);
        return false;
      }
      toasts.info('Short deleted', '');
      return true;
    },
    [run, toasts],
  );
  return { remove, isDeleting };
}
