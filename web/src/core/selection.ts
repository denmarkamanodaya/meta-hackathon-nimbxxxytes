// Moment selection on the Search screen: picked segment ids in the order the user picked them,
// which is the order the editor receives them.
import type { ClipDetail, SearchResult } from '../services/api/types';
import { formatDuration } from './format';
import { clipCount } from './gallery';
import { spansInRange } from './player';
import type { Span } from './timeline';

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

/** The Gallery selection in Select mode, and the clip a Shift-click range starts from. */
export interface SelectModeState {
  /** Selected clip ids, in selection order. */
  selected: string[];
  /** The last clip ticked without Shift; null before the first tick. */
  anchor: string | null;
}

/**
 * A click on a clip in Select mode: a plain click ticks or unticks it; a Shift-click also ticks
 * every clip between the anchor and it, in the order the clips are shown, keeping the others.
 * @param state - The selection and its anchor.
 * @param id - The clicked clip.
 * @param order - Every clip id in the order shown.
 * @param isRange - Shift was held.
 * @returns The new selection and anchor; a range keeps the anchor, a tick moves it to `id`.
 */
export function selectModeClick(state: SelectModeState, id: string, order: readonly string[], isRange: boolean): SelectModeState {
  const from = state.anchor === null ? -1 : order.indexOf(state.anchor);
  const to = order.indexOf(id);
  if (!isRange || from < 0 || to < 0) return { selected: toggleSelection(state.selected, id), anchor: id };
  const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
  return { selected: [...state.selected, ...range.filter((item) => !state.selected.includes(item))], anchor: state.anchor };
}

/**
 * The Select mode bar's line: "3 clips selected".
 * @param count - Clips selected.
 * @returns The line.
 */
export const clipsSelectedLine = (count: number): string => `${clipCount(count)} selected`;

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
 * One moment of a clip as an editor hand-off row (the shape Search results have).
 * @param clip - The clip it belongs to.
 * @param segment - The moment.
 * @returns The row; `reason` is the moment's description and `score` is 0.
 */
export function momentRow(clip: ClipDetail['clip'], segment: ClipDetail['segments'][number]): SearchResult {
  return {
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
  };
}

/**
 * Every moment of one clip as editor hand-off rows, in clip order.
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
    moments: segments.map((segment) => momentRow(clip, segment)),
  };
}

/**
 * The moments a range of one clip touches, as editor hand-off rows ("Make a short from this
 * range" on the Mac player, "Make a short with this face" on Faces).
 * @param detail - The clip and its segments.
 * @param span - The range, clip seconds.
 * @returns The hand-off: the touched segment ids in clip order and their result rows.
 */
export function handoffFromRange(
  detail: Pick<ClipDetail, 'clip' | 'segments'>,
  span: Span,
): { segmentIds: string[]; moments: SearchResult[] } {
  return handoffFromClip({ clip: detail.clip, segments: spansInRange(detail.segments, span) });
}
