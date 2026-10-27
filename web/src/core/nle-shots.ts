// The Mac Short page's "In the timeline" list (mock M2): each shot of the cut as the FCPXML holds
// it, with its start on the output timeline, its thumb, its name and the editor's reason.
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
      thumbUrl: segment?.thumb_url ?? null,
      name: names.get(clip.segment_id) ?? `Shot ${String(i + 1)}`,
      reason: clip.reason,
    };
    start += Math.max(0, clip.out - clip.in);
    return row;
  });
}
