// In-memory cache of recent search answers, so going back from a clip to /search?q=… shows the
// same results at once instead of paying for another rewrite + rerank.
import type { SearchResponse } from '../api/types';

/** Least-recently-used cache of search answers keyed by the exact query. */
export interface SearchCache {
  get: (query: string) => SearchResponse | undefined;
  set: (query: string, response: SearchResponse) => void;
}

/**
 * Creates an empty cache.
 * @param max - Most answers kept; the least recently used is dropped first.
 * @returns The cache.
 */
export function createSearchCache(max: number): SearchCache {
  const entries = new Map<string, SearchResponse>();
  return {
    get: (query) => {
      const hit = entries.get(query);
      if (hit !== undefined) {
        entries.delete(query);
        entries.set(query, hit); // refresh recency
      }
      return hit;
    },
    set: (query, response) => {
      entries.delete(query);
      entries.set(query, response);
      const oldest = entries.keys().next();
      if (entries.size > max && oldest.done !== true) entries.delete(oldest.value);
    },
  };
}
