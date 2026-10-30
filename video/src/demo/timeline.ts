// The demo's timing. Each scene holds its voice-over lines and never runs shorter than its designed
// length (src/components/voTiming.ts). Line lengths come from src/demo/vo.generated.json (made by
// scripts/make-vo.py --lines src/demo/vo-lines.json ...), so a re-spoken line retimes the demo.

import { lineAt, placeLines, VO_FPS, type VoLine } from '../components/voTiming';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

export const DEMO_FPS = VO_FPS;

/**
 * The scenes in order: the shortest each may be, and the spacing around its lines, in seconds.
 * The "forgetting you" hook (HookScene.tsx) is hidden for now; to bring it back, add
 * `{ id: 'hook', min: 2.5, lead: 0, gap: 0, tail: 0 }` after problems and map it in Demo.tsx.
 */
const SPECS = [
  { id: 'problems', min: 3.5, lead: 0.1, gap: 0.15, tail: 0.2 },
  { id: 'care', min: 1.9, lead: 0.1, gap: 0, tail: 0.25 },
  { id: 'storage', min: 3, lead: 0.1, gap: 0.2, tail: 0.27 },
] as const;

export type DemoSceneId = (typeof SPECS)[number]['id'];

/** One spoken line, in frames from the start of its scene. */
export type DemoLine = VoLine;

/** One scene on the demo: where it starts, how long it runs, and its lines. */
export interface DemoScene {
  id: DemoSceneId;
  from: number;
  durationInFrames: number;
  lines: readonly DemoLine[];
}

function build(): DemoScene[] {
  let at = 0;
  return SPECS.map((spec) => {
    const own = (lines as { id: string; scene: string; text: string }[]).filter((line) => line.scene === spec.id);
    const placed = placeLines(own, generated, spec);
    const scene = { id: spec.id, from: at, durationInFrames: placed.durationInFrames, lines: placed.lines };
    at += placed.durationInFrames;
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
export const lineOf = (scene: DemoScene, index: number): DemoLine => lineAt(scene.lines, index);

/** What every demo scene gets: its place on the demo, with its lines. */
export interface DemoSceneProps {
  scene: DemoScene;
}
