// The Mac's universal search bar, shared through context so any screen can send the owner to it
// (the Shorts empty state's "Find moments", ⌘K). The shell that draws the bar provides the real
// function; elsewhere (the PWA, tests) it does nothing.
import { createContext, useContext } from 'react';

/** Puts the cursor in the search bar, optionally with `query` typed in. */
export type FocusSearch = (query?: string) => void;

/** Provided by the Mac shell around every screen. */
export const SearchBarContext = createContext<FocusSearch>(() => undefined);

/**
 * The search bar's focus action.
 * @returns A function that focuses the bar; a no-op outside the Mac shell.
 */
export function useFocusSearch(): FocusSearch {
  return useContext(SearchBarContext);
}
