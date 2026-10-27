// The Mac Short page's "In the timeline" list (redesign v2, V7): each shot of the cut as the
// FCPXML holds it, with its start on the output timeline, its thumb, its name and the editor's
// reason; and where the player's scrubber marks the cuts between shots.
import { formatClipTime } from './format';
import type { ShotNames } from './humanize';
import type { ShortSegment, TimelineClip } from '../services/api/types';

/** One row of the list. */
export interface NleShot {
  /** Stable key: position plus segment id (a segment may repeat). */
  key: string;
  segmentId: string;
  /** Source clip, for the Original / Proxy badge; null when the segment is unknown. */
  clipId: string | null;
  /** Start on the output timeline, `m:ss.s`. */
  at: string;
  /** The same start in seconds (the player seeks there; the scrubber marks it). */
  startS: number;
  thumbUrl: string | null;
  name: string;
  reason: string;
}

/**
 * Lays the cut's shots end to end.
 * @param clips - The version's timeline clips, in order.
 * @param segments - The short's candidate segments (clip id and thumb per segment).
 * @param names - Shot names by segment id.
 * @returns One row per shot; starts are cumulative sums of `out - in`, in seconds.
 */
export function nleShots(
  clips: readonly TimelineClip[],
  segments: readonly ShortSegment[],
  names: ShotNames,
): NleShot[] {
  const bySegment = new Map(segments.map((segment) => [segment.segment_id, segment]));
  let start = 0;
  return clips.map((clip, i) => {
    const segment = bySegment.get(clip.segment_id);
    const row: NleShot = {
      key: `${String(i)}:${clip.segment_id}`,
      segmentId: clip.segment_id,
      clipId: segment?.clip_id ?? null,
      at: formatClipTime(start),
      startS: start,
      thumbUrl: segment?.thumb_url ?? null,
      name: names.get(clip.segment_id) ?? `Shot ${String(i + 1)}`,
      reason: clip.reason,
    };
    start += Math.max(0, clip.out - clip.in);
    return row;
  });
}

/**
 * Where the scrubber marks a cut between shots: each shot's start after the first, as a
 * percentage of the whole short (its end card included).
 * @param starts - Shot starts on the output timeline, seconds, in order.
 * @param totalS - The short's length, seconds.
 * @returns Percentages 0–100; none for an empty short.
 */
export function cutPercents(starts: readonly number[], totalS: number): number[] {
  if (!(totalS > 0)) return [];
  return starts
    .slice(1)
    .filter((s) => s > 0 && s < totalS)
    .map((s) => (s / totalS) * 100);
}

/**
 * Which shot plays at a time: the last one starting at or before it.
 * @param starts - Shot starts, seconds, in order.
 * @param seconds - The playhead.
 * @returns The shot's index, or -1 before the first (or with none).
 */
export function shotAt(starts: readonly number[], seconds: number): number {
  let index = -1;
  starts.forEach((s, i) => {
    if (s <= seconds) index = i;
  });
  return index;
}
