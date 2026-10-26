// Pure frame maths shared by the composition, the server and the PWA editor: where each clip
// sits on the output timeline, how long the short is, which caption and word are live, the
// output size per quality, and props derived from an edited timeline.
import type { Caption, ShortAspect, ShortClip, ShortProps } from './composition/schema.ts';

/** Composition width in px; previews render the same layout scaled down. */
export const BASE_WIDTH = 1080;

/**
 * Seconds to whole frames.
 * @param seconds - Time in seconds.
 * @param fps - Frames per second.
 * @returns Rounded frame count.
 */
export const toFrames = (seconds: number, fps: number): number => Math.round(seconds * fps);

/** Where one clip sits on the output timeline, in frames. */
export interface ClipTiming {
  /** First output frame. */
  from: number;
  durationInFrames: number;
  /** Source frames skipped before the clip starts (its `in`). */
  trimBefore: number;
}

/**
 * Lays clips end to end.
 * @param clips - Clips in play order.
 * @param fps - Frames per second.
 * @returns One timing per clip; every clip lasts at least one frame.
 */
export function clipTimings(clips: readonly Pick<ShortClip, 'in_s' | 'out_s'>[], fps: number): ClipTiming[] {
  let from = 0;
  return clips.map((clip) => {
    const durationInFrames = Math.max(1, toFrames(clip.out_s - clip.in_s, fps));
    const timing = { from, durationInFrames, trimBefore: toFrames(clip.in_s, fps) };
    from += durationInFrames;
    return timing;
  });
}

/**
 * Total length of the short: all clips plus the end card.
 * @param props - Short props.
 * @returns Frames, at least 1.
 */
export function totalFrames(props: Pick<ShortProps, 'clips' | 'fps' | 'end_card_s'>): number {
  const clips = clipTimings(props.clips, props.fps).reduce((sum, t) => sum + t.durationInFrames, 0);
  return Math.max(1, clips + toFrames(props.end_card_s, props.fps));
}

/**
 * Composition size for an aspect (always 1080 wide).
 * @param aspect - Output frame.
 * @returns Width and height in px.
 */
export function dimensions(aspect: ShortAspect): { width: number; height: number } {
  return aspect === '4:5' ? { width: BASE_WIDTH, height: 1350 } : { width: BASE_WIDTH, height: BASE_WIDTH };
}

/** Render quality. Preview is for the agent's critique; final is the post. */
export type Quality = 'preview' | 'final';

/**
 * Output size per aspect and quality. Preview 4:5 is 544×680, not 540×675: h264 needs even sides.
 * @param aspect - Output frame.
 * @param quality - Preview or final.
 * @returns Width and height in px.
 */
export function outputSize(aspect: ShortAspect, quality: Quality): { width: number; height: number } {
  if (quality === 'final') return dimensions(aspect);
  return aspect === '4:5' ? { width: 544, height: 680 } : { width: 540, height: 540 };
}

/**
 * Factor that fits the 1080-wide layout into an output width (the composition scales its stage
 * by this, so a preview is the same picture at a smaller size).
 * @param outputWidth - Rendered width in px.
 * @returns outputWidth / 1080.
 */
export const stageScale = (outputWidth: number): number => outputWidth / BASE_WIDTH;

/**
 * The caption on screen at a source time: `[start_s, end_s)`, the latest-starting one on overlap.
 * @param captions - Captions of the clip, any order.
 * @param sourceS - Seconds on the source clip.
 * @returns The caption, or null.
 */
export function activeCaption(captions: readonly Caption[], sourceS: number): Caption | null {
  let active: Caption | null = null;
  for (const caption of captions) {
    const isLive = caption.start_s <= sourceS && sourceS < caption.end_s;
    if (isLive && (active === null || caption.start_s >= active.start_s)) active = caption;
  }
  return active;
}

/**
 * The word being said: the last word whose `at_s` has passed.
 * @param caption - The live caption.
 * @param sourceS - Seconds on the source clip.
 * @returns Word index, or -1 before the first word.
 */
export function activeWordIndex(caption: Caption, sourceS: number): number {
  let index = -1;
  caption.words.forEach((word, i) => {
    if (word.at_s <= sourceS) index = i;
  });
  return index;
}

/**
 * How a shot is named when there is no picture or for the Studio timeline: its subject, else
 * "Shot N" (1-based), the same rule the PWA trail uses. Never the raw segment id.
 * @param clip - The shot.
 * @param index - Its 0-based position in the short.
 * @returns The label.
 */
export const shotLabel = (clip: Pick<ShortClip, 'subject'>, index: number): string =>
  clip.subject ?? `Shot ${String(index + 1)}`;

/** A shot as the editor holds it (the web `TimelineClip` fits). */
export interface DraftClip {
  segment_id: string;
  in: number;
  out: number;
  punch_in: number;
  subject: string | null;
}

/**
 * Props for an edited timeline, without a server round trip: each draft clip keeps its
 * source URL and captions from `base` (matched by segment id) and takes the draft's order,
 * in/out, zoom and subject. Clips whose segment is not in `base` are dropped.
 * @param base - Props the server built for the version.
 * @param draft - The edited clips, in play order.
 * @returns New props.
 */
export function deriveProps(base: ShortProps, draft: readonly DraftClip[]): ShortProps {
  const bySegment = new Map(base.clips.map((clip) => [clip.segment_id, clip]));
  const clips = draft.flatMap((edit): ShortClip[] => {
    const source = bySegment.get(edit.segment_id);
    if (source === undefined) return [];
    return [{ ...source, in_s: edit.in, out_s: edit.out, punch_in: edit.punch_in, subject: edit.subject }];
  });
  return { ...base, clips };
}
