// NimbytesIntro: the nimbytes introduction, built scene by scene on the demo's white page, with its
// voice-over (British female, normal speed): "Meet nimbytes, your intelligent storage solution,
// powered by Meta AI." (src/intro/vo-lines.json).
import { Audio, Sequence, Series, staticFile } from 'remotion';
import { placeLines } from '../components/voTiming';
import { MeetScene } from './MeetScene';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

/** The scenes in order, with their lengths in frames at 30 fps. */
const SCENES = [{ id: 'meet', Scene: MeetScene, durationInFrames: 150 }] as const;

/** The voice-over, from 0.3 s; the intro stays at least as long as its scenes. */
const VO = placeLines(lines, generated, { min: 5, lead: 0.3, gap: 0, tail: 0.5 });

/** The intro's length in frames. */
export const INTRO_FRAMES = Math.max(VO.durationInFrames, SCENES.reduce((sum, scene) => sum + scene.durationInFrames, 0));

export function Intro() {
  return (
    <>
      <Series>
        {SCENES.map(({ id, Scene, durationInFrames }) => (
          <Series.Sequence key={id} durationInFrames={durationInFrames}>
            <Scene />
          </Series.Sequence>
        ))}
      </Series>
      {VO.lines.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`audio/intro-vo/${line.id}.wav`)} />
        </Sequence>
      ))}
    </>
  );
}
