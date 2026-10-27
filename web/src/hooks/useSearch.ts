// Search hooks: run the query in the URL (cached for back navigation), recent queries, and
// debounced people autocomplete.
import { useCallback, useEffect, useState } from 'react';
import { nextSearchView, type SearchStep, type SearchView } from '../core/search-progress';
import type { Person, SearchResponse } from '../services/api/types';
import { useServices } from './services-context';

/** Search state for the current query. */
export type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | ({ status: 'done' } & SearchView)
  | { status: 'error'; message: string };

const fromCache = (response: SearchResponse): SearchState => ({
  status: 'done',
  response,
  localTookMs: null,
  isRefining: false,
});

/**
 * Runs `query` (from `/search?q=`) as a streamed search: local results show at once, then the
 * Muse Spark order replaces them. Only the ranked answer is cached; a cached answer shows at
 * once without a request. A failure after the local stage keeps the local results.
 * @param query - The query, or '' for none.
 * @returns The search state for that query.
 */
export function useSearch(query: string): SearchState {
  const { api, searchCache } = useServices();
  const [result, setResult] = useState<{ query: string; state: SearchState }>({
    query: '',
    state: { status: 'idle' },
  });

  useEffect(() => {
    if (query === '' || searchCache.get(query) !== undefined) return undefined;
    const controller = new AbortController();
    let view: SearchView | null = null;
    const apply = (step: SearchStep) => {
      if (controller.signal.aborted) return;
      view = nextSearchView(view, step);
      if (view !== null) setResult({ query, state: { status: 'done', ...view } });
    };
    api
      .searchStream(
        query,
        (stage) => {
          if (stage.stage === 'ranked') searchCache.set(query, stage.response);
          apply(stage);
        },
        controller.signal,
      )
      .then(
        () => {
          apply({ stage: 'ended' });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          if (view !== null) {
            apply({ stage: 'ended' });
            return;
          }
          const message = error instanceof Error ? error.message : 'Search failed';
          setResult({ query, state: { status: 'error', message } });
        },
      );
    return () => {
      controller.abort();
    };
  }, [api, searchCache, query]);

  if (query === '') return { status: 'idle' };
  if (result.query === query) return result.state;
  const cached = searchCache.get(query);
  return cached === undefined ? { status: 'searching' } : fromCache(cached);
}

/**
 * Recent queries from storage, with record and clear.
 * @returns The list (newest first) and its mutators.
 */
export function useRecentQueries(): {
  recent: string[];
  record: (query: string) => void;
  clear: () => void;
} {
  const { recents } = useServices();
  const [recent, setRecent] = useState(() => recents.read());
  const record = useCallback(
    (query: string) => {
      setRecent(recents.record(query));
    },
    [recents],
  );
  const clear = useCallback(() => {
    recents.clear();
    setRecent([]);
  }, [recents]);
  return { recent, record, clear };
}

/** Autocomplete debounce in ms. */
export const AUTOCOMPLETE_DELAY_MS = 200;

/**
 * Names starting with `prefix`, fetched `delayMs` after typing stops; older requests are aborted.
 * @param prefix - What the user typed.
 * @param delayMs - Debounce delay.
 * @returns Matching people; empty for a blank prefix or on error.
 */
export function usePeopleSuggestions(
  prefix: string,
  delayMs: number = AUTOCOMPLETE_DELAY_MS,
): Person[] {
  const { api } = useServices();
  const [found, setFound] = useState<{ prefix: string; people: Person[] }>({ prefix: '', people: [] });
  const clean = prefix.trim();

  useEffect(() => {
    if (clean === '') return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.listPeople(clean, controller.signal).then(
        (people) => {
          setFound({ prefix: clean, people });
        },
        () => {
          // Recovers: suggestions are optional; typing a full name still works.
        },
      );
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, clean, delayMs]);

  return clean !== '' && found.prefix === clean ? found.people : [];
}
