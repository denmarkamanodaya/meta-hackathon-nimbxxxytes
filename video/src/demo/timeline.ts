// The demo's scenes, built one at a time: each with its length in frames. Later scenes append here.

export const DEMO_FPS = 30;

export const DEMO_SCENES = [
  { id: 'problems', durationInFrames: 105 },
  { id: 'hook', durationInFrames: 75 },
  { id: 'care', durationInFrames: 60 },
  { id: 'storage', durationInFrames: 90 },
] as const;

export type DemoSceneId = (typeof DEMO_SCENES)[number]['id'];

/** The whole demo's length in frames. */
export const DEMO_FRAMES = DEMO_SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0);
