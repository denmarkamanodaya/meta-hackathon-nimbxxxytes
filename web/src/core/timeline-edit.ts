// Pure edits on a timeline's clips (reorder, drop, trim within segment bounds), its length, and
// the difference between two versions for the critique trail.
import type { ShortSegment, TimelineClip } from '../services/api/types';

/** Shortest clip the renderer keeps, in seconds (the server drops shorter ones). */
export const MIN_CLIP_S = 0.6;

/**
 * Moves the clip at `from` to `to`.
 * @param clips - Clips in play order.
 * @param from - Current index.
 * @param to - Target index (clamped into the list).
 * @returns A new list; unchanged when `from` is out of range.
 */
export function moveClip(clips: readonly TimelineClip[], from: number, to: number): TimelineClip[] {
  const next = [...clips];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...clips];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/**
 * Removes the clip at `index`.
 * @param clips - Clips in play order.
 * @param index - Clip to drop.
 * @returns A new list without it.
 */
export function dropClip(clips: readonly TimelineClip[], index: number): TimelineClip[] {
  return clips.filter((_, i) => i !== index);
}

/**
 * Sets a clip's in or out point, kept inside its segment and at least `MIN_CLIP_S` long.
 * @param clip - The clip.
 * @param edge - Which point moves.
 * @param seconds - Requested time on the source clip.
 * @param segment - The clip's segment bounds.
 * @returns The trimmed clip.
 */
export function trimClip(
  clip: TimelineClip,
  edge: 'in' | 'out',
  seconds: number,
  segment: Pick<ShortSegment, 'start_s' | 'end_s'>,
): TimelineClip {
  // A segment shorter than the minimum still allows a clip as long as the segment.
  const minLength = Math.min(MIN_CLIP_S, Math.max(0, segment.end_s - segment.start_s));
  if (edge === 'in') {
    const latest = Math.min(clip.out, segment.end_s) - minLength;
    return { ...clip, in: round(Math.min(Math.max(seconds, segment.start_s), latest)) };
  }
  const earliest = Math.max(clip.in, segment.start_s) + minLength;
  return { ...clip, out: round(Math.max(Math.min(seconds, segment.end_s), earliest)) };
}

const round = (seconds: number) => Math.round(seconds * 10) / 10;

/**
 * Total output length of the clips.
 * @param clips - Clips in play order.
 * @returns Seconds, rounded to 0.1.
 */
export function timelineLength(clips: readonly TimelineClip[]): number {
  return round(clips.reduce((sum, clip) => sum + Math.max(0, clip.out - clip.in), 0));
}

/** How a clip differs between two versions. */
export type ClipChange = 'added' | 'removed' | 'retimed' | 'moved';

/** One line of a version diff. */
export interface ClipDiff {
  segment_id: string;
  change: ClipChange;
}

/**
 * Lists what changed from `before` to `after`, keyed by segment id: clips added, removed,
 * retimed (in/out changed) or moved (relative order changed among the clips both keep).
 * @param before - Previous version's clips.
 * @param after - This version's clips.
 * @returns Changes in `after` order, then removed clips in `before` order.
 */
export function diffClips(before: readonly TimelineClip[], after: readonly TimelineClip[]): ClipDiff[] {
  const old = new Map(before.map((clip) => [clip.segment_id, clip]));
  const kept = new Set(after.map((clip) => clip.segment_id));
  const oldOrder = before.filter((clip) => kept.has(clip.segment_id)).map((c) => c.segment_id);
  const newOrder = after.filter((clip) => old.has(clip.segment_id)).map((c) => c.segment_id);
  const diffs: ClipDiff[] = [];
  for (const clip of after) {
    const previous = old.get(clip.segment_id);
    if (previous === undefined) {
      diffs.push({ segment_id: clip.segment_id, change: 'added' });
    } else if (previous.in !== clip.in || previous.out !== clip.out) {
      diffs.push({ segment_id: clip.segment_id, change: 'retimed' });
    } else if (oldOrder.indexOf(clip.segment_id) !== newOrder.indexOf(clip.segment_id)) {
      diffs.push({ segment_id: clip.segment_id, change: 'moved' });
    }
  }
  for (const clip of before) {
    if (!kept.has(clip.segment_id)) diffs.push({ segment_id: clip.segment_id, change: 'removed' });
  }
  return diffs;
}
