// Where a search query lives in the Mac app: on the Library, as `/?q=` (and `&project=` while the
// search is kept to one project).

/**
 * The Library path for a query.
 * @param query - The query, or null for none.
 * @returns `/?q=<encoded>`, or `/` for no query or a blank one.
 */
export function libraryQueryPath(query: string | null): string {
  return librarySearchPath(query, null);
}

/**
 * The Library path for a query kept to a project ("Search in this project").
 * @param query - The query, or null for none.
 * @param projectId - The project, or null for the whole library.
 * @returns `/?q=<encoded>&project=<id>`, without the parts that are empty; `/` for neither.
 */
export function librarySearchPath(query: string | null, projectId: string | null): string {
  const clean = query?.trim() ?? '';
  const params = new URLSearchParams({ ...(clean === '' ? {} : { q: clean }), ...(projectId === null ? {} : { project: projectId }) });
  const search = params.toString();
  return search === '' ? '/' : `/?${search}`;
}
