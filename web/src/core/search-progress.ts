// What the Search screen shows while a streamed search runs: the local results at once, then the
// Muse Spark order in their place. A stream that stops after the local stage keeps its results.
import type { SearchResponse, SearchStage } from '../services/api/types';

/** The results on screen and how they got there. */
export interface SearchView {
  response: SearchResponse;
  /** Server time of the local stage when the ranked stage replaced it; null otherwise. */
  localTookMs: number | null;
  /** True while local results wait for the ranked stage. */
  isRefining: boolean;
}

/** One step of a streamed search: a stage arrived, or the stream ended without more. */
export type SearchStep = SearchStage | { stage: 'ended' };

/**
 * Applies one step.
 * @param view - What is shown now; null before the first stage.
 * @param step - The step.
 * @returns What to show next. A `local` stage after `ranked` changes nothing; `ended` stops the
 *   refining state and keeps the local results, with the local time as the only time.
 */
export function nextSearchView(view: SearchView | null, step: SearchStep): SearchView | null {
  switch (step.stage) {
    case 'local':
      if (view !== null && !view.isRefining) return view;
      return { response: step.response, localTookMs: null, isRefining: true };
    case 'ranked':
      return {
        response: step.response,
        localTookMs: view?.isRefining === true ? view.response.took_ms : null,
        isRefining: false,
      };
    case 'ended':
      return view === null ? null : { ...view, isRefining: false };
  }
}
