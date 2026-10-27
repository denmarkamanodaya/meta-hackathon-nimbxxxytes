// Deleting clips, shorts and productions, only ever from the owner's tap on a confirm sheet or
// dialog. Clips go one at a time (the Mac Library deletes several), and the result comes back for
// the caller's toast; one short or one production toasts here.
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

/** A production to delete, and whether its story short goes too. */
export interface ProductionDeleteTarget {
  productionId: string;
  /** Also delete its story short and renders (the dialog's checkbox). */
  alsoShort: boolean;
  /** Its story short when the caller knows it (null: none); left out, it is looked up first. */
  shortId?: string | null;
}

/**
 * Deletes a production (`DELETE /productions/{id}`), and with `alsoShort` its story short too
 * (`DELETE /shorts/{id}`). The short is looked up before the production goes, since the production
 * is what names it. Toasts how it went.
 * @returns The delete; it resolves true once the production is gone (even when its short stayed).
 */
export function useDeleteProduction(): DeleteOne<ProductionDeleteTarget> {
  const { api, toasts } = useServices();
  const [isDeleting, setDeleting] = useState(false);
  const remove = useCallback(
    async ({ productionId, alsoShort, shortId }: ProductionDeleteTarget) => {
      setDeleting(true);
      try {
        const storyId = !alsoShort ? null : shortId !== undefined ? shortId : (await api.getProduction(productionId)).production.short_id;
        await api.deleteProduction(productionId);
        if (storyId === null) {
          toasts.info('Production deleted', '');
          return true;
        }
        try {
          await api.deleteShort(storyId);
          toasts.info('Production and its short deleted', '');
        } catch (error) {
          toasts.error('Production deleted; its short could not be', error);
        }
        return true;
      } catch (error) {
        toasts.error('Could not delete the production', error);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [api, toasts],
  );
  return { remove, isDeleting };
}
