// The whole demo so far: every scene in order, back to back.
import type { ComponentType } from 'react';
import { Series } from 'remotion';
import { CareScene } from './CareScene';
import { HookScene } from './HookScene';
import { ProblemsScene } from './ProblemsScene';
import { StorageScene } from './StorageScene';
import { DEMO_SCENES, type DemoSceneId } from './timeline';

export const DEMO_COMPONENTS: Readonly<Record<DemoSceneId, ComponentType>> = {
  problems: ProblemsScene,
  hook: HookScene,
  care: CareScene,
  storage: StorageScene,
};

export function Demo() {
  return (
    <Series>
      {DEMO_SCENES.map(({ id, durationInFrames }) => {
        const Scene = DEMO_COMPONENTS[id];
        return (
          <Series.Sequence key={id} durationInFrames={durationInFrames}>
            <Scene />
          </Series.Sequence>
        );
      })}
    </Series>
  );
}
