// The line under the search box: how many photos, and moments in how many clips, and plain badges for how
// the answer was made (refined by Muse Spark, or asked before and free).
import type { SearchView } from './search-progress';

/**
 * A search answer kept to some clips ("Search in this project"): the server searches the whole
 * library, and the results outside the clips are dropped here.
 * @param response - The answer.
 * @param clipIds - The clips to keep, or null for all.
 * @returns The answer with only those clips' moments, in the same order.
 */
export function scopeToClips<T extends { results: readonly { clip_id: string }[] }>(response: T, clipIds: readonly string[] | null): T {
  if (clipIds === null) return response;
  return { ...response, results: response.results.filter((result) => clipIds.includes(result.clip_id)) };
}

/**
 * "7 moments in 4 clips", or with photos "2 photos · 1 moment in 1 clip" (a photo belongs to no
 * clip, so it never counts as one).
 * @param results - Search results (a row without `kind` is a moment).
 * @returns The count line.
 */
export function momentsLine(results: readonly { clip_id: string; kind?: 'moment' | 'photo' }[]): string {
  const photos = results.filter((r) => r.kind === 'photo').length;
  const found = results.filter((r) => r.kind !== 'photo');
  const clips = new Set(found.map((r) => r.clip_id)).size;
  const moments = `${String(found.length)} ${found.length === 1 ? 'moment' : 'moments'} in ${String(clips)} ${clips === 1 ? 'clip' : 'clips'}`;
  if (photos === 0) return moments;
  const photoWords = `${String(photos)} ${photos === 1 ? 'photo' : 'photos'}`;
  return found.length === 0 ? photoWords : `${photoWords} · ${moments}`;
}

/** One plain badge on the results line. */
export interface SearchBadge {
  text: string;
  tone: 'accent' | 'success' | 'neutral';
}

/** The repeat-search badge: a cached answer costs nothing. */
export const ASKED_BEFORE = 'Asked before · free';

/**
 * Seconds as the results line writes them: one decimal, "under 0.1 s" below that.
 * @param ms - Milliseconds.
 * @returns For example "2.5 s".
 */
export function plainSeconds(ms: number): string {
  return ms < 100 ? 'under 0.1 s' : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The badges beside "N moments in M clips", in words instead of engine telemetry: who refined the
 * order and how long it took, and "Asked before · free" when the answer came from the cache (its
 * time is the cache's, so it is left out).
 * @param view - What the Search screen shows (the ranked answer, or held local results).
 * @returns The badges, in order.
 */
export function searchBadges(view: SearchView): SearchBadge[] {
  const { response } = view;
  if (response.cached) {
    const refined: SearchBadge[] = response.reranked ? [{ text: 'Refined by Muse Spark', tone: 'accent' }] : [];
    return [...refined, { text: ASKED_BEFORE, tone: 'success' }];
  }
  if (response.reranked) return [{ text: `Refined by Muse Spark · ${plainSeconds(response.took_ms)}`, tone: 'accent' }];
  return [{ text: `Instant answer · ${plainSeconds(view.localTookMs ?? response.took_ms)}`, tone: 'neutral' }];
}
