// The whole demo: every scene in order, back to back, with each voice-over line (British female)
// playing at its place in its scene.
import type { ComponentType } from 'react';
import { Audio, Sequence, Series, staticFile } from 'remotion';
import { CareScene } from './CareScene';
import { HookScene } from './HookScene';
import { ProblemsScene } from './ProblemsScene';
import { StorageScene } from './StorageScene';
import { DEMO_SCENES, type DemoSceneId, type DemoSceneProps } from './timeline';

export const DEMO_COMPONENTS: Readonly<Record<DemoSceneId, ComponentType<DemoSceneProps>>> = {
  problems: ProblemsScene,
  hook: HookScene,
  care: CareScene,
  storage: StorageScene,
};

export function Demo() {
  return (
    <Series>
      {DEMO_SCENES.map((scene) => {
        const Scene = DEMO_COMPONENTS[scene.id];
        return (
          <Series.Sequence key={scene.id} durationInFrames={scene.durationInFrames}>
            <Scene scene={scene} />
            {scene.lines.map((line) => (
              <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
                <Audio src={staticFile(`audio/demo-vo/${line.id}.wav`)} />
              </Sequence>
            ))}
          </Series.Sequence>
        );
      })}
    </Series>
  );
}
