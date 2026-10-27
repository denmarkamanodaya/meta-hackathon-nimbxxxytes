// The line under the search box: how many moments in how many clips, and what the search
// cost (time, and money unless it came from the cache).
import type { SearchResponse } from '../services/api/types';

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
  const seconds = (response.took_ms / 1000).toFixed(2);
  if (response.cached) return { text: `${seconds} s · cached, $0`, isCached: true };
  const cost = response.cost_usd === 0 ? '$0' : `$${response.cost_usd < 0.01 ? response.cost_usd.toFixed(4) : response.cost_usd.toFixed(3)}`;
  return { text: `${seconds} s · ${cost}`, isCached: false };
}
