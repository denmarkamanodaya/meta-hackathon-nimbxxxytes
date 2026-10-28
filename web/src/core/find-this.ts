// Pure rules of Find this (board V18): the in-view band on the scrubber, the label chip, the
// summary line and hit rows of the right column, and the hits as an editor hand-off.
import type { FindHit, FindResponse, SearchResult, SecondsRange } from '../services/api/types';
import { FIND_COPY } from './copy';
import { formatDuration, formatShortDate } from './format';

/** "0:12–0:19". */
export const rangeText = (range: SecondsRange): string => `${formatDuration(range.start_s)}–${formatDuration(range.end_s)}`;

/**
 * The in-view band on the scrubber, as percentages of the clip.
 * @param range - Where the object is in view.
 * @param durationS - The clip's length; NaN or 0 while unknown.
 * @returns Left and width in %, or null while the length is unknown.
 */
export function inViewBand(range: SecondsRange, durationS: number): { left: number; width: number } | null {
  if (!Number.isFinite(durationS) || durationS <= 0) return null;
  const start = Math.min(Math.max(range.start_s, 0), durationS);
  const end = Math.min(Math.max(range.end_s, start), durationS);
  return { left: (start / durationS) * 100, width: ((end - start) / durationS) * 100 };
}

/**
 * The chip on the frame: "mug · in view 0:41–0:58".
 * @param found - The answer.
 * @returns The chip text.
 */
export const chipText = (found: Pick<FindResponse, 'label' | 'in_view'>): string => `${found.label} · in view ${rangeText(found.in_view)}`;

/**
 * Clips other than the tapped one that the object was found in.
 * @param hits - The hits.
 * @param clipId - The tapped clip.
 * @returns How many other clips.
 */
export const otherClipCount = (hits: readonly FindHit[], clipId: string): number =>
  new Set(hits.filter((h) => h.clip_id !== clipId).map((h) => h.clip_id)).size;

/**
 * Under the label: "In view 0:41–0:58 here · seen in 4 other clips".
 * @param found - The answer.
 * @param clipId - The tapped clip.
 * @returns The line.
 */
export function foundSummary(found: FindResponse, clipId: string): string {
  const others = otherClipCount(found.hits, clipId);
  const elsewhere = others === 0 ? 'not seen in other clips' : `seen in ${String(others)} other ${others === 1 ? 'clip' : 'clips'}`;
  return `In view ${rangeText(found.in_view)} here · ${elsewhere}`;
}

/**
 * The second line of a hit row: "This clip · 0:41–0:58" or "22 Oct · 0:04–0:09".
 * @param hit - The hit.
 * @param clipId - The tapped clip.
 * @param now - Today (the year check of the date).
 * @returns The line.
 */
export function hitLine(hit: FindHit, clipId: string, now: Date): string {
  const when = hit.clip_id === clipId ? FIND_COPY.thisClip : hit.recorded_at === null ? '' : formatShortDate(hit.recorded_at, now);
  const range = rangeText(hit);
  return when === '' ? range : `${when} · ${range}`;
}

/**
 * The hits as the editor's hand-off ("Make a short from these"), one moment per segment, in the
 * order found.
 * @param hits - The hits.
 * @returns Segment ids and result rows.
 */
export function handoffFromHits(hits: readonly FindHit[]): { segmentIds: string[]; moments: SearchResult[] } {
  const seen = new Set<string>();
  const unique = hits.filter((hit) => {
    if (seen.has(hit.segment_id)) return false;
    seen.add(hit.segment_id);
    return true;
  });
  return {
    segmentIds: unique.map((hit) => hit.segment_id),
    moments: unique.map((hit) => ({
      segment_id: hit.segment_id,
      clip_id: hit.clip_id,
      start_s: hit.start_s,
      end_s: hit.end_s,
      thumb_url: hit.thumb_url,
      reason: null,
      score: hit.score,
      clip_filename: hit.clip_title,
      clip_title: hit.clip_title,
      recorded_at: hit.recorded_at,
      faces: [],
    })),
  };
}
