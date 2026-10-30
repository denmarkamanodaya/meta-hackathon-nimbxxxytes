// NimbytesIntro: the nimbytes introduction, built scene by scene on the demo's white page.
import { Series } from 'remotion';
import { MeetScene } from './MeetScene';

/** The scenes in order, with their lengths in frames at 30 fps. */
const SCENES = [{ id: 'meet', Scene: MeetScene, durationInFrames: 150 }] as const;

/** The intro's length in frames. */
export const INTRO_FRAMES = SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0);

export function Intro() {
  return (
    <Series>
      {SCENES.map(({ id, Scene, durationInFrames }) => (
        <Series.Sequence key={id} durationInFrames={durationInFrames}>
          <Scene />
        </Series.Sequence>
      ))}
    </Series>
  );
}
