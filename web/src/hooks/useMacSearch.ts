// Data and wiring for the Mac's universal search bar: the debounced query, the popover's answer
// (the streamed search, the results' clips for Speech, and the clip, short and project lists for
// the title chips), and the slot a page drawn in columns offers the bar so it sits in that page's
// middle column.
import { createContext, useContext, useEffect, useState } from 'react';
import { barView, type BarView, type SearchScope } from '../core/search-bar';
import { useClipDetailsLoad, useClips } from './useClips';
import { useShortsList } from './useOverview';
import { useProjects } from './useProjects';
import { useSearch } from './useSearch';

/** Typing pause before the bar searches, ms. */
export const BAR_DEBOUNCE_MS = 350;

/**
 * `value`, once it has stayed the same for `delayMs`.
 * @param value - The changing value.
 * @param delayMs - The pause.
 * @returns The settled value.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}

/** What the popover shows. */
export type BarState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'error'; message: string }
  | { status: 'done'; view: BarView };

const NONE: readonly never[] = [];

/**
 * The popover's answer for a query. It stays `searching` while the search runs (the same spinner
 * rule as the Gallery: the unranked local stage is held back) and while the results' clips load,
 * since a result is Speech or a Moment by its clip's transcript.
 * @param query - The settled query; '' for none.
 * @param scope - The scope button's choice.
 * @returns The state.
 */
export function useBarResults(query: string, scope: SearchScope): BarState {
  const search = useSearch(query);
  const results = search.status === 'done' ? search.response.results : NONE;
  // A photo has no clip to load.
  const { details, isLoading } = useClipDetailsLoad(results.filter((result) => result.kind === 'moment').map((result) => result.clip_id));
  const { state: clips } = useClips();
  const { state: shorts } = useShortsList();
  const { state: projects } = useProjects();
  if (search.status === 'idle') return { status: 'idle' };
  if (search.status === 'error') return { status: 'error', message: search.message };
  if (search.status === 'searching' || isLoading) return { status: 'searching' };
  const sources = {
    clips: clips.status === 'ready' ? clips.data : NONE,
    shorts: shorts.status === 'ready' ? shorts.data : NONE,
    projects: projects.status === 'ready' ? projects.data : NONE,
  };
  return { status: 'done', view: barView(results, details, query, scope, sources) };
}

/** Registers the element the bar is drawn into; returns the cleanup that gives it back. */
export type RegisterSearchSlot = (element: HTMLElement | null) => (() => void) | undefined;

/** Provided by the Mac shell; null elsewhere (a page then draws no slot). */
export const MacSearchSlotContext = createContext<RegisterSearchSlot | null>(null);

/**
 * The shell's slot registration, for `MacColumns`.
 * @returns A ref callback for the slot element, or null outside the Mac shell.
 */
export function useMacSearchSlot(): RegisterSearchSlot | null {
  return useContext(MacSearchSlotContext);
}
