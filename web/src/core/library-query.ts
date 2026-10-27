// Where a search query lives in the Mac app: on the Library, as `/?q=`.

/**
 * The Library path for a query.
 * @param query - The query, or null for none.
 * @returns `/?q=<encoded>`, or `/` for no query or a blank one.
 */
export function libraryQueryPath(query: string | null): string {
  const clean = query?.trim() ?? '';
  return clean === '' ? '/' : `/?${new URLSearchParams({ q: clean }).toString()}`;
}
