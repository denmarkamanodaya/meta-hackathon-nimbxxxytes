// The line under the search box: how many moments in how many clips, and what the search
// cost (time, and money unless it came from the cache).
import type { SearchResponse } from '../services/api/types';
import type { SearchView } from './search-progress';

const seconds = (ms: number) => (ms / 1000).toFixed(2);

/**
 * "7 moments in 4 clips".
 * @param results - Search results.
 * @returns The count line.
 */
export function momentsLine(results: readonly { clip_id: string }[]): string {
  const clips = new Set(results.map((r) => r.clip_id)).size;
  const moments = `${String(results.length)} ${results.length === 1 ? 'moment' : 'moments'}`;
  return `${moments} in ${String(clips)} ${clips === 1 ? 'clip' : 'clips'}`;
}

/**
 * "0.06 s · cached, $0" or "1.84 s · $0.0031".
 * @param response - The search answer.
 * @returns Timing and cost; `isCached` picks the success colour.
 */
export function costLine(response: Pick<SearchResponse, 'took_ms' | 'cached' | 'cost_usd'>): {
  text: string;
  isCached: boolean;
} {
  const time = seconds(response.took_ms);
  if (response.cached) return { text: `${time} s · cached, $0`, isCached: true };
  const cost = response.cost_usd === 0 ? '$0' : `$${response.cost_usd < 0.01 ? response.cost_usd.toFixed(4) : response.cost_usd.toFixed(3)}`;
  return { text: `${time} s · ${cost}`, isCached: false };
}

/**
 * The cost line of a streamed search: "0.21 s" while refining (spend not final yet), then
 * "0.21 s · refined 3.92 s · $0.0031"; a search without a local stage reads as `costLine`.
 * @param view - What the Search screen shows.
 * @returns Timing and cost; `isCached` picks the success colour.
 */
export function viewCostLine(view: SearchView): { text: string; isCached: boolean } {
  if (view.isRefining) return { text: `${seconds(view.response.took_ms)} s`, isCached: false };
  const total = costLine(view.response);
  if (view.localTookMs === null) return total;
  return { text: `${seconds(view.localTookMs)} s · refined ${total.text}`, isCached: total.isCached };
}
