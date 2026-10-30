// The demo's timing. Each scene holds its voice-over lines (a lead-in, a gap between lines, a hold
// after the last) and never runs shorter than its designed length. Line lengths come from
// src/demo/vo.generated.json (made by scripts/make-vo.py --lines src/demo/vo-lines.json ...), so a
// re-spoken line retimes the demo.

import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

export const DEMO_FPS = 30;

/** The scenes in order: the shortest each may be, and the spacing around its lines, in seconds. */
const SPECS = [
  { id: 'problems', min: 3.5, lead: 0.2, gap: 0.3, tail: 0.6 },
  { id: 'hook', min: 2.5, lead: 0, gap: 0, tail: 0 },
  { id: 'care', min: 2, lead: 0.2, gap: 0, tail: 0.5 },
  { id: 'storage', min: 3, lead: 0.2, gap: 0.4, tail: 0.8 },
] as const;

export type DemoSceneId = (typeof SPECS)[number]['id'];

/** One spoken line, in frames from the start of its scene. */
export interface DemoLine {
  id: string;
  text: string;
  from: number;
  durationInFrames: number;
}

/** One scene on the demo: where it starts, how long it runs, and its lines. */
export interface DemoScene {
  id: DemoSceneId;
  from: number;
  durationInFrames: number;
  lines: readonly DemoLine[];
}

const f = (seconds: number) => Math.round(seconds * DEMO_FPS);
const spoken = (id: string): number => (generated as Record<string, { seconds: number } | undefined>)[id]?.seconds ?? 2;

function build(): DemoScene[] {
  let at = 0;
  return SPECS.map((spec) => {
    let cursor = f(spec.lead);
    const own = (lines as { id: string; scene: string; text: string }[]).filter((line) => line.scene === spec.id);
    const placed = own.map((line, index) => {
      if (index > 0) cursor += f(spec.gap);
      const durationInFrames = f(spoken(line.id));
      const result = { id: line.id, text: line.text, from: cursor, durationInFrames };
      cursor += durationInFrames;
      return result;
    });
    const durationInFrames = Math.max(f(spec.min), placed.length === 0 ? 0 : cursor + f(spec.tail));
    const scene = { id: spec.id, from: at, durationInFrames, lines: placed };
    at += durationInFrames;
    return scene;
  });
}

export const DEMO_SCENES: readonly DemoScene[] = build();

/** The whole demo's length in frames. */
export const DEMO_FRAMES = DEMO_SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0);

/**
 * A scene's line, with a fallback so a missing line never breaks a render.
 * @param scene - The scene.
 * @param index - Which of its lines.
 * @returns The line (a zero-length line at the scene start when missing).
 */
export const lineOf = (scene: DemoScene, index: number): DemoLine => scene.lines[index] ?? { id: '', text: '', from: 0, durationInFrames: 0 };

/** What every demo scene gets: its place on the demo, with its lines. */
export interface DemoSceneProps {
  scene: DemoScene;
}
