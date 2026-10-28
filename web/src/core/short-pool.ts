// The moments "Make a short" hands the editor from one or more clips (the Mac Gallery's selection,
// a project, a clip's own button): each clip's moments best first, taken round-robin across the
// clips so every clip with moments is in the pool, up to the API's limit.
import type { ClipDetail, ClipSummary, SearchResult, Segment } from '../services/api/types';
import { clipCount } from './gallery';
import { momentRow, type EditorHandoff } from './selection';

/** Most moments one short may start from (`POST /api/shorts` rejects more than 20 segment ids). */
export const SHORT_POOL_MAX = 20;

/** A score that is not there yet ranks below every real one (0–10). */
const MISSING_SCORE = -1;

/**
 * Orders a clip's moments best first: higher `hook_score`, then higher `quality`, then clip order.
 * @param segments - One clip's moments.
 * @returns A new array, best first.
 */
export function bestFirst(segments: readonly Segment[]): Segment[] {
  return [...segments].sort(
    (a, b) =>
      (b.hook_score ?? MISSING_SCORE) - (a.hook_score ?? MISSING_SCORE) ||
      (b.quality ?? MISSING_SCORE) - (a.quality ?? MISSING_SCORE) ||
      a.idx - b.idx,
  );
}

/** What the pool hands the editor: the ids in send order and their rows in the same order. */
export interface ShortPool extends EditorHandoff {
  moments: SearchResult[];
}

/**
 * The editor's pool: round 1 takes each clip's best moment in selection order, round 2 each
 * clip's second best, and so on, until `max` moments or every moment is taken. A clip with no
 * moments adds nothing.
 * @param details - The selected clips with their moments, in selection order.
 * @param max - The most moments to send; defaults to the API limit.
 * @returns The pool; empty when no clip has a moment.
 */
export function shortPool(details: readonly Pick<ClipDetail, 'clip' | 'segments'>[], max = SHORT_POOL_MAX): ShortPool {
  const queues = details.map((detail) => ({ clip: detail.clip, ranked: bestFirst(detail.segments) }));
  const longest = Math.max(0, ...queues.map((queue) => queue.ranked.length));
  const moments: SearchResult[] = [];
  for (let round = 0; round < longest && moments.length < max; round += 1) {
    for (const { clip, ranked } of queues) {
      const segment = ranked[round];
      if (segment !== undefined && moments.length < max) moments.push(momentRow(clip, segment));
    }
  }
  return { segmentIds: moments.map((moment) => moment.segment_id), moments };
}

/**
 * "8 moments from 3 clips": how many moments the editor got and from how many clips.
 * @param moments - The hand-off rows.
 * @returns The line.
 */
export function poolLine(moments: readonly Pick<SearchResult, 'clip_id'>[]): string {
  const clips = new Set(moments.map((moment) => moment.clip_id)).size;
  const count = moments.length;
  return `${String(count)} ${count === 1 ? 'moment' : 'moments'} from ${clipCount(clips)}`;
}

/**
 * Whether a short can start from these clips: at least one is ready and has a moment.
 * @param clips - The selected clips.
 * @returns True when the pool would not be empty.
 */
export const hasMoments = (clips: readonly Pick<ClipSummary, 'status' | 'segment_count'>[]): boolean =>
  clips.some((clip) => clip.status === 'ready' && clip.segment_count > 0);
