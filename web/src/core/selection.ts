// Moment selection on the Search screen: picked segment ids in the order the user picked them,
// which is the order the editor receives them.
import type { ClipDetail, SearchResult } from '../services/api/types';
import { formatDuration } from './format';

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
 * A click on a Mac Gallery tile or row (redesign v2): a plain click selects that clip alone (the
 * right column shows it); ⌘-click toggles it in the selection. Opening is a double click or Enter.
 * @param selected - Selected tile ids.
 * @param id - The clicked tile.
 * @param isToggle - ⌘ (or Ctrl) was held.
 * @returns The new selection.
 */
export function tileClick(selected: readonly string[], id: string, isToggle: boolean): string[] {
  return isToggle ? toggleSelection(selected, id) : [id];
}

/**
 * What a right-click menu acts on: the whole selection when the tile is part of it, else that
 * tile alone (which then becomes the selection).
 * @param selected - Selected tile ids.
 * @param id - The right-clicked tile.
 * @returns The ids, in selection order.
 */
export function menuTargets(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? [...selected] : [id];
}

/**
 * The picked ids still on screen, in pick order: a pick made on the local results drops out when
 * the ranked results no longer hold that moment.
 * @param selected - Picked ids in pick order.
 * @param shown - Results on screen.
 * @returns The picks among `shown`.
 */
export function pickedAmong(selected: readonly string[], shown: readonly SearchResult[]): string[] {
  return selected.filter((id) => shown.some((row) => row.segment_id === id));
}

/**
 * The selection bar's line: how many moments are picked and how long they run together.
 * @param picked - Picked segment ids.
 * @param rows - Results on screen (start and end in seconds).
 * @returns For example "2 moments · 0:15"; "0 moments · 0:00" before anything is picked.
 */
export function pickedSummary(
  picked: readonly string[],
  rows: readonly Pick<SearchResult, 'segment_id' | 'start_s' | 'end_s'>[],
): string {
  const chosen = rows.filter((row) => picked.includes(row.segment_id));
  const seconds = chosen.reduce((sum, row) => sum + Math.max(0, row.end_s - row.start_s), 0);
  return `${String(chosen.length)} ${chosen.length === 1 ? 'moment' : 'moments'} · ${formatDuration(seconds)}`;
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
 * Every moment of several clips, clip after clip ("Make a short from this project").
 * @param details - The clips and their segments, in the order to hand over.
 * @returns One hand-off with every clip's moments.
 */
export function handoffFromClips(details: readonly Pick<ClipDetail, 'clip' | 'segments'>[]): ReturnType<typeof handoffFromClip> {
  const each = details.map(handoffFromClip);
  return { segmentIds: each.flatMap((h) => h.segmentIds), moments: each.flatMap((h) => h.moments) };
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
