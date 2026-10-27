// The acts strip of a story short: each shot of the cut, in cut order, sized by its length and
// named by the planned shot it came from. The planner's act order is a request, not a rule, so a
// shot the editor added on its own reads "not in plan", and planned shots that are not in the cut
// are listed as missing.
import type { Act, ActShot } from '../services/api/types';

/** One shot of the cut. */
export interface StripPart {
  /** Planned act, or null for a shot that is not in the plan. */
  act: Act | null;
  /** The planned shot's title; null for a shot that is not in the plan. */
  title: string | null;
  start_s: number;
  end_s: number;
  /** Share of the cut's length, 0–1 (the part's width). */
  share: number;
}

/** The strip and the planned shots it lacks. */
export interface ActsStrip {
  parts: StripPart[];
  /** Planned shots not in the cut (never filmed, or dropped by the editor), in play order. */
  missing: ActShot[];
  /** The cut's length, seconds. */
  length_s: number;
}

/** The fields of a timeline clip the strip reads. */
export interface StripClip {
  segment_id: string;
  in: number;
  out: number;
}

/**
 * Lays the cut out against the plan.
 * @param clips - The shown draft's timeline clips, in cut order.
 * @param shots - The production's planned shots.
 * @returns Parts in cut order with their place on the cut, and the missing planned shots.
 */
export function actsStrip(clips: readonly StripClip[], shots: readonly ActShot[]): ActsStrip {
  const planned = [...shots].sort((a, b) => a.ord - b.ord);
  const length = clips.reduce((sum, clip) => sum + Math.max(0, clip.out - clip.in), 0);
  let at = 0;
  const parts = clips.map((clip): StripPart => {
    const shot = planned.find((s) => s.segment_id === clip.segment_id);
    const duration = Math.max(0, clip.out - clip.in);
    const part: StripPart = {
      act: shot?.act ?? null,
      title: shot?.title ?? null,
      start_s: at,
      end_s: at + duration,
      share: length > 0 ? duration / length : 0,
    };
    at += duration;
    return part;
  });
  const used = new Set(clips.map((clip) => clip.segment_id));
  const missing = planned.filter((s) => s.segment_id === null || !used.has(s.segment_id));
  return { parts, missing, length_s: length };
}
