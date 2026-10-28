// Pure rules of Keep subject in frame (board V19): each shot's tracked status, the Finish column's
// status line, when to start tracking, and the Centre crop preview (the props without crop_path).
import type { ReframeResponse, ReframeShot, ReframeStatus, TimelineClip } from '../services/api/types';
import { REFRAME_COPY } from './copy';

/** One shot's status under its title; `isLost` shows it in the warning colour. */
export interface ShotStatus {
  text: string;
  isLost: boolean;
}

const seconds = (s: number) => `${String(Math.max(1, Math.round(s)))} s`;

/**
 * What one shot's tracking says: "Followed all 6 s", "Lost it for 2 s · held still".
 * @param clip - The timeline shot.
 * @param status - The short's tracking status.
 * @param shot - The shot's tracking row, when there is one.
 * @returns The status.
 */
export function shotStatus(clip: Pick<TimelineClip, 'in' | 'out' | 'subject'>, status: ReframeStatus, shot: ReframeShot | undefined): ShotStatus {
  if (clip.subject === null) return { text: REFRAME_COPY.noSubject, isLost: false };
  if (status === 'running') return { text: REFRAME_COPY.tracking, isLost: false };
  if (shot === undefined || status !== 'ready') return { text: REFRAME_COPY.waiting, isLost: false };
  if (shot.lost_s > 0) return { text: `Lost it for ${seconds(shot.lost_s)} · held still`, isLost: true };
  return { text: `Followed all ${seconds(clip.out - clip.in)}`, isLost: false };
}

/**
 * The tracking row of a shot, matched by segment and subject (a changed subject has no row yet).
 * @param reframe - The tracking answer.
 * @param clip - The shot.
 * @returns The row, if any.
 */
export const shotRow = (reframe: ReframeResponse | null, clip: Pick<TimelineClip, 'segment_id' | 'subject'>): ReframeShot | undefined =>
  reframe?.shots.find((s) => s.segment_id === clip.segment_id && s.subject === clip.subject);

/**
 * The Finish column's line: "4 of 4 shots followed · 1 lost the subject for 2 s and held still".
 * @param keepSubject - The switch.
 * @param reframe - The tracking answer; null while it loads.
 * @param clips - The shots of the shown draft.
 * @returns The line.
 */
export function reframeSummary(keepSubject: boolean, reframe: ReframeResponse | null, clips: readonly TimelineClip[]): string {
  if (!keepSubject) return REFRAME_COPY.off;
  if (reframe === null || reframe.status === 'idle') return REFRAME_COPY.waiting;
  if (reframe.status === 'running') return REFRAME_COPY.tracking;
  if (reframe.status === 'failed') return REFRAME_COPY.failed;
  const followed = clips.filter((c) => c.subject !== null);
  const rows = followed.map((c) => shotRow(reframe, c)).filter((r): r is ReframeShot => r !== undefined);
  const lost = rows.filter((r) => r.lost_s > 0);
  const head = `${String(rows.length)} of ${String(followed.length)} shots followed`;
  if (lost.length === 0) return head;
  const first = lost[0];
  const tail =
    lost.length === 1 && first !== undefined
      ? `1 lost the subject for ${seconds(first.lost_s)} and held still`
      : `${String(lost.length)} lost the subject and held still`;
  return `${head} · ${tail}`;
}

/**
 * Whether opening the Short page starts tracking: the switch is on and nothing ran yet.
 * @param keepSubject - The switch.
 * @param status - The tracking status.
 * @returns True to POST /reframe.
 */
export const shouldStartReframe = (keepSubject: boolean, status: ReframeStatus): boolean => keepSubject && status === 'idle';

/**
 * Whether to keep asking for the tracking status.
 * @param status - The last status.
 * @returns True while it runs.
 */
export const isReframeRunning = (status: ReframeStatus): boolean => status === 'running';

/** Player props in the shape these helpers need: shots that may carry a crop path. */
interface WithClips<C> {
  clips: readonly C[];
}

/**
 * Whether any shot of the props follows a subject.
 * @param props - Player props.
 * @returns True when a shot carries a non-empty `crop_path`.
 */
export function hasCropPath<C extends object>(props: WithClips<C>): boolean {
  return props.clips.some((clip) => 'crop_path' in clip && Array.isArray(clip.crop_path) && clip.crop_path.length > 0);
}

/** The frame Keep subject in frame is about: 9:16 posts. */
export const REFRAME_ASPECT = '9:16';

/**
 * The Short page's Keep subject in frame preview (board V19): always the 9:16 export frame, whatever
 * the short's own aspect; Follows subject keeps each shot's crop path, Centre crop drops it.
 * @param props - The Player props.
 * @param isFollow - Follows subject (true) or Centre crop.
 * @returns New props; the two choices differ only in `crop_path`.
 */
export function reframePreviewProps<P extends WithClips<object>>(props: P, isFollow: boolean): P & { export_aspect: typeof REFRAME_ASPECT } {
  return { ...(isFollow ? props : withoutCropPath(props)), export_aspect: REFRAME_ASPECT };
}

/**
 * The props as a centre crop: every shot without its `crop_path`.
 * @param props - Player props.
 * @returns New props; the input is unchanged.
 */
export function withoutCropPath<P extends WithClips<object>>(props: P): P {
  return {
    ...props,
    clips: props.clips.map((clip) => Object.fromEntries(Object.entries(clip).filter(([key]) => key !== 'crop_path'))),
  };
}
