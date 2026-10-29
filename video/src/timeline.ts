// The promo's timing, built from the voice-over: each scene holds its lines (spoken one after
// another with a gap), a lead-in before the first and a hold after the last. The line lengths come
// from src/vo.generated.json (made by scripts/make-vo.py), so a re-spoken line retimes everything.

import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

export const FPS = 30;
/** The cut never runs past the music (136 s), which plays once from the first frame. */
export const MAX_FRAMES = Math.floor(136 * 30);

export type SceneId =
  | 'p-both'
  | 'p-whatif'
  | 'hook'
  | 'price'
  | 'creators'
  | 'dementia'
  | 'care'
  | 'bridge'
  | 'whatif'
  | 'meet'
  | 'zero'
  | 'understand'
  | 'search'
  | 'copies'
  | 'iguide'
  | 'uses'
  | 'iread'
  | 'models'
  | 'glasses'
  | 'close';

interface SceneSpec {
  id: SceneId;
  /** Seconds before the first line. */
  lead: number;
  /** Seconds between lines. */
  gap: number;
  /** Seconds held after the last line. */
  tail: number;
  /**
   * Seconds each line owns, from its start to the next line's start (or the scene's end), when a
   * capture under it needs longer than the speech. A line never gets less than its speech.
   */
  slots?: readonly number[];
}

/** The scenes in order. */
const SPECS: readonly SceneSpec[] = [
  { id: 'p-both', lead: 0.3, gap: 0, tail: 0.6 },
  { id: 'p-whatif', lead: 0.2, gap: 0.4, tail: 0.8 },
  { id: 'meet', lead: 0.6, gap: 0.6, tail: 1.6 },
  { id: 'zero', lead: 0.3, gap: 0.8, tail: 6.4 },
  { id: 'search', lead: 0.2, gap: 0, tail: 0.6, slots: [5.0, 7.0, 6.2, 5.6] },
  { id: 'copies', lead: 0.4, gap: 0.4, tail: 1.4 },
  { id: 'iguide', lead: 0.3, gap: 0, tail: 0.2, slots: [5.4, 4.4, 2.5] },
  { id: 'uses', lead: 0.3, gap: 0, tail: 1.2 },
  { id: 'iread', lead: 0.3, gap: 0.9, tail: 1.6 },
  { id: 'models', lead: 0.3, gap: 0.8, tail: 2.2 },
  { id: 'close', lead: 0.8, gap: 1.0, tail: 3.5 },
];

/** One spoken line placed on the video. */
export interface Line {
  id: string;
  /** `device` for the app's own read-aloud voice (the Mac's voice), shown as the app speaking. */
  voice?: string;
  scene: SceneId;
  text: string;
  /** Start and length, in frames from the start of the video. */
  from: number;
  durationInFrames: number;
}

/** One scene placed on the video, with its lines. */
export interface Scene {
  id: SceneId;
  from: number;
  durationInFrames: number;
  lines: Line[];
}

const f = (seconds: number) => Math.round(seconds * FPS);
const seconds = (id: string): number => (generated as Record<string, { seconds: number } | undefined>)[id]?.seconds ?? 2;

/**
 * Lays the scenes out back to back from the line lengths.
 * @returns The scenes, each with its lines.
 */
export function buildTimeline(): Scene[] {
  let at = 0;
  return SPECS.map((spec) => {
    const own = (lines as { id: string; scene: SceneId; text: string; voice?: string }[]).filter((line) => line.scene === spec.id);
    const from = at;
    let cursor = from + f(spec.lead);
    const placed = own.map((line, index) => {
      if (index > 0) cursor += f(spec.gap);
      const placedLine = { ...line, from: cursor, durationInFrames: f(seconds(line.id)) };
      cursor += Math.max(placedLine.durationInFrames, f(spec.slots?.[index] ?? 0));
      return placedLine;
    });
    const durationInFrames = cursor + f(spec.tail) - from;
    at += durationInFrames;
    return { id: spec.id, from, durationInFrames, lines: placed };
  });
}

export const TIMELINE: readonly Scene[] = buildTimeline();
export const TOTAL_FRAMES: number = TIMELINE.reduce((sum, scene) => sum + scene.durationInFrames, 0);
/** The end note after the fade to black, in frames. */
export const END_NOTE_FRAMES = 3 * FPS;
export const LINES: readonly Line[] = TIMELINE.flatMap((scene) => scene.lines);

/**
 * A scene of the video.
 * @param id - The scene.
 * @returns It.
 */
export function sceneOf(id: SceneId): Scene {
  const scene = TIMELINE.find((s) => s.id === id);
  if (scene === undefined) throw new Error(`scene ${id} is not on the timeline`);
  return scene;
}

/**
 * Where a scene's line starts, in frames from the start of the scene.
 * @param id - The scene.
 * @param index - Which of its lines.
 * @returns The frame.
 */
export const lineAt = (id: SceneId, index: number): number => {
  const scene = sceneOf(id);
  return (scene.lines[index]?.from ?? scene.from) - scene.from;
};
