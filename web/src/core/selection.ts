// Moment selection on the Search screen: picked segment ids in the order the user picked them,
// which is the order the editor receives them.
import type { ClipDetail, SearchResult } from '../services/api/types';

/**
 * Adds `id` at the end, or removes it when already picked.
 * @param selected - Picked ids in pick order.
 * @param id - Segment id tapped.
 * @returns The new selection.
 */
export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

/**
 * What the Search screen hands the editor in router state: the picked ids in pick order, and
 * the full result rows so the editor shows thumbnails and reasons without a request.
 */
export interface EditorHandoff {
  segmentIds: string[];
  moments: unknown[];
}

/**
 * Reads the editor's router state, which may be anything (a reload drops it, a bookmark has none).
 * @param state - `location.state`.
 * @returns The picked segment ids, or an empty list.
 */
export function readEditorHandoff(state: unknown): string[] {
  if (typeof state !== 'object' || state === null || !('segmentIds' in state)) return [];
  const ids = state.segmentIds;
  return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : [];
}

/**
 * Reads the `t` query parameter that deep-links into a clip at a second.
 * @param raw - `searchParams.get('t')`.
 * @returns Seconds >= 0, or null when missing or not a number.
 */
export function readStartParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Every moment of one clip as editor hand-off rows ("Make a short from this clip").
 * @param detail - The clip and its segments.
 * @returns The hand-off: segment ids in clip order and matching result rows.
 */
export function handoffFromClip(detail: Pick<ClipDetail, 'clip' | 'segments'>): {
  segmentIds: string[];
  moments: SearchResult[];
} {
  const { clip, segments } = detail;
  return {
    segmentIds: segments.map((segment) => segment.segment_id),
    moments: segments.map((segment) => ({
      segment_id: segment.segment_id,
      clip_id: clip.clip_id,
      start_s: segment.start_s,
      end_s: segment.end_s,
      thumb_url: segment.thumb_url,
      reason: segment.description,
      score: 0,
      clip_filename: clip.filename,
      clip_title: clip.title,
      recorded_at: clip.recorded_at,
      faces: [],
    })),
  };
}
