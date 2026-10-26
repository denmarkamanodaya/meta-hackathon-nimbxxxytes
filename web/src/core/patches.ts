// Optimistic edits: local patches laid over server rows until the server answer replaces them.

/**
 * Applies per-id patches to a list of rows.
 * @param rows - Server rows.
 * @param patches - Patch by row id.
 * @param idOf - Reads a row's id.
 * @returns New rows with patches merged; untouched rows keep their identity.
 */
export function applyPatches<T>(
  rows: readonly T[],
  patches: ReadonlyMap<string, Partial<T>>,
  idOf: (row: T) => string,
): T[] {
  return rows.map((row) => {
    const patch = patches.get(idOf(row));
    return patch === undefined ? row : { ...row, ...patch };
  });
}
