// Recent search queries: newest first, no duplicates (case-insensitive), capped.

/** Most recent queries kept. */
export const MAX_RECENT_QUERIES = 8;

/**
 * Adds `query` to the front, removing an earlier copy that differs only in case or spacing.
 * @param recent - Current list, newest first.
 * @param query - The query just run.
 * @param max - Cap on the list length.
 * @returns The new list; unchanged for a blank query.
 */
export function addRecentQuery(
  recent: readonly string[],
  query: string,
  max: number = MAX_RECENT_QUERIES,
): string[] {
  const clean = query.trim().replace(/\s+/g, ' ');
  if (clean === '') return [...recent];
  const key = clean.toLowerCase();
  return [clean, ...recent.filter((item) => item.toLowerCase() !== key)].slice(0, max);
}
