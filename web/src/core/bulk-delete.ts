// Deleting several things one after another (the Mac Library's "Delete N clips…", and every
// single delete as a list of one), and the toast that reports how it went.

/** What a run of deletes did. */
export interface DeleteOutcome {
  /** Ids that are gone, in order. */
  deleted: string[];
  /** Ids that are still there. */
  failed: string[];
  /** The first failure's error (for the toast's code), or null when none failed. */
  firstError: unknown;
}

/**
 * Deletes `ids` one at a time, in order, and keeps going after a failure.
 * @param ids - What to delete.
 * @param remove - Deletes one id; rejects on failure.
 * @returns Which went and which stayed.
 */
export async function deleteInOrder(ids: readonly string[], remove: (id: string) => Promise<unknown>): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { deleted: [], failed: [], firstError: null };
  for (const id of ids) {
    try {
      await remove(id);
      outcome.deleted.push(id);
    } catch (error) {
      // Recovers: the run continues; the failure is counted and reported in one toast.
      if (outcome.failed.length === 0) outcome.firstError = error;
      outcome.failed.push(id);
    }
  }
  return outcome;
}

/** The toast after deleting clips. */
export type DeleteToast = { tone: 'info'; title: string } | { tone: 'error'; title: string; error: unknown };

const clips = (n: number) => `${String(n)} ${n === 1 ? 'clip' : 'clips'}`;

/**
 * Words for the toast after deleting clips.
 * @param outcome - The run.
 * @returns "Clip deleted", "3 clips deleted", "Could not delete the clip" or
 *   "Could not delete 1 of 3 clips".
 */
export function clipDeleteToast(outcome: DeleteOutcome): DeleteToast {
  const total = outcome.deleted.length + outcome.failed.length;
  if (outcome.failed.length === 0) return { tone: 'info', title: total === 1 ? 'Clip deleted' : `${clips(total)} deleted` };
  const title = total === 1 ? 'Could not delete the clip' : `Could not delete ${String(outcome.failed.length)} of ${clips(total)}`;
  return { tone: 'error', title, error: outcome.firstError };
}
