// Near-copies (Phase 29): Keep both (`POST /clips/{id}/keep`), and removing copies, one or all of
// them, only ever from the owner's confirm. There is no bulk endpoint: copies go one at a time
// through `DELETE /clips/{id}`, and the run counts how many are done so the confirm can show it.
import { useCallback, useState } from 'react';
import { deleteInOrder, type DeleteOutcome } from '../core/bulk-delete';
import { copiesRemovedTitle } from '../core/similar';
import { useServices } from './services-context';

/** Keep both and whether it runs. */
export interface KeepClip {
  /** Resolves true once the server took it (then refresh the clip and the list). */
  keep: (clipId: string) => Promise<boolean>;
  isKeeping: boolean;
}

/**
 * Keep both: the near-copy becomes a normal clip and nimbytes understands it like any other.
 * Toasts how it went.
 * @returns The action.
 */
export function useKeepClip(): KeepClip {
  const { api, toasts } = useServices();
  const [isKeeping, setKeeping] = useState(false);
  const keep = useCallback(
    async (clipId: string) => {
      setKeeping(true);
      try {
        await api.keepClip(clipId);
        toasts.info('Kept both', 'This clip is now searched like any other.');
        return true;
      } catch (error) {
        // Recovers: the clip stays a near-copy; the toast says why.
        toasts.error('Could not keep this clip', error);
        return false;
      } finally {
        setKeeping(false);
      }
    },
    [api, toasts],
  );
  return { keep, isKeeping };
}

/** Removing copies and how far the run is. */
export interface RemoveCopies {
  /** Deletes the copies in order; resolves what went and what stayed (never rejects). */
  remove: (clipIds: readonly string[]) => Promise<DeleteOutcome>;
  /** Copies handled so far in the current run, and how many it has; null when idle. */
  progress: { done: number; total: number } | null;
}

/**
 * Removes copies (`DELETE /clips/{id}` each) and toasts "3 copies removed" or which stayed.
 * @returns The action.
 */
export function useRemoveCopies(): RemoveCopies {
  const { api, toasts } = useServices();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const remove = useCallback(
    async (clipIds: readonly string[]) => {
      setProgress({ done: 0, total: clipIds.length });
      try {
        const outcome = await deleteInOrder(clipIds, async (id) => {
          try {
            await api.deleteClip(id);
          } finally {
            setProgress((now) => (now === null ? now : { ...now, done: now.done + 1 }));
          }
        });
        const title = copiesRemovedTitle(outcome.deleted.length, outcome.failed.length);
        if (outcome.failed.length === 0) toasts.info(title, '');
        else toasts.error(title, outcome.firstError);
        return outcome;
      } finally {
        setProgress(null);
      }
    },
    [api, toasts],
  );
  return { remove, progress };
}
