// The whole promo: the scenes from the timeline (each crossfading over the one before), the
// British voice-over line by line, the music raw (its own level, no ducking or fades; from when nimbytes is shown, once, no loop),  and a fade to black at the end.
import type { ComponentType } from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { hasAsset } from './components/assets';
import { CloseScene, GlassesScene, ModelsScene } from './promo/CloseScenes';
import type { SceneProps } from './promo/parts';
import { ProblemBothScene, ProblemWhatIfScene } from './promo/ProblemScenes';
import { CopiesScene, IGuideScene, IReadScene, MeetScene, SearchScene, UnderstandScene, UsesScene, ZeroScene } from './promo/ProductScenes';
import { BridgeScene, CareScene, CreatorsScene, DementiaScene, HookScene, PriceScene, WhatIfScene } from './promo/StoryScenes';
import { END_NOTE_FRAMES, LINES, sceneOf, TIMELINE, TOTAL_FRAMES, type SceneId } from './timeline';
import { INTER } from './fonts';

const SCENES: Readonly<Record<SceneId, ComponentType<SceneProps>>> = {
  'p-both': ProblemBothScene,
  'p-whatif': ProblemWhatIfScene,
  hook: HookScene,
  price: PriceScene,
  creators: CreatorsScene,
  dementia: DementiaScene,
  care: CareScene,
  bridge: BridgeScene,
  whatif: WhatIfScene,
  meet: MeetScene,
  zero: ZeroScene,
  understand: UnderstandScene,
  search: SearchScene,
  copies: CopiesScene,
  iguide: IGuideScene,
  uses: UsesScene,
  iread: IReadScene,
  models: ModelsScene,
  glasses: GlassesScene,
  close: CloseScene,
};

/** Frames each scene overlaps the next, fading in over it. */
const CROSSFADE = 18;

/** Scene change: the incoming scene dissolves in over the last, settling from a slight scale. Calm, no blur. */
function Fade({ isFirst, isLast, length, children }: { isFirst: boolean; isLast: boolean; length: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const inT = isFirst ? 1 : interpolate(frame, [0, CROSSFADE], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const outT = isLast ? 0 : interpolate(frame, [length - CROSSFADE, length], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  return (
    <AbsoluteFill style={{ opacity: inT, transform: `scale(${String(1.015 - 0.015 * inT - outT * 0.01)})` }}>
      {children}
    </AbsoluteFill>
  );
}


/** The opener track starts 1:20 in (owner choice). */
const PROBLEM_MUSIC_SKIP = 80 * 30;

/** Music level: one fixed, lower level under the voice (no ducking or fades). */
const MUSIC_LEVEL = 0.35;

/** The promo music starts with nimbytes and plays once, never looped; the problem opener has its own calm track. */
const MUSIC_FROM = sceneOf('meet').from;
/** The track's length in frames (136 s). */
const MUSIC_FRAMES = Math.round(136 * 30);


/** After the fade to black: one quiet white line, bottom right. */
function EndNote() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [6, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <div style={{ position: 'absolute', right: 96, bottom: 80, fontFamily: INTER, fontWeight: 300, fontSize: 30, color: '#FFFFFF', opacity }}>
        nimbytes is better paired with vision ingestion, such as Meta AI glasses.
      </div>
    </AbsoluteFill>
  );
}

export function Promo() {
  const frame = useCurrentFrame();
  const black = interpolate(frame, [TOTAL_FRAMES - 15, TOTAL_FRAMES - 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {TIMELINE.map((scene, index) => {
        const Scene = SCENES[scene.id];
        const isLast = index === TIMELINE.length - 1;
        return (
          <Sequence key={scene.id} name={scene.id} from={scene.from} durationInFrames={scene.durationInFrames + (isLast ? 0 : CROSSFADE)}>
            <Fade isFirst={index === 0} isLast={isLast} length={scene.durationInFrames + (isLast ? 0 : CROSSFADE)}>
              <Scene scene={scene} />
            </Fade>
          </Sequence>
        );
      })}
      {LINES.filter((line) => hasAsset(`audio/vo/${line.id}.wav`)).map((line) => (
        <Sequence key={line.id} name={`vo ${line.id}`} from={line.from} durationInFrames={line.durationInFrames + 15}>
          <Audio src={staticFile(`audio/vo/${line.id}.wav`)} />
        </Sequence>
      ))}
      {hasAsset('audio/music-problem.mp3') && (
        <Sequence name="music-problem" from={0} durationInFrames={MUSIC_FROM}>
          <Audio src={staticFile('audio/music-problem.mp3')} trimBefore={PROBLEM_MUSIC_SKIP} volume={(f) => MUSIC_LEVEL * interpolate(f, [MUSIC_FROM - 15, MUSIC_FROM], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
        </Sequence>
      )}
      {hasAsset('audio/music.mp3') && (
        <Sequence name="music" from={MUSIC_FROM} durationInFrames={MUSIC_FRAMES}>
          <Audio src={staticFile('audio/music.mp3')} volume={MUSIC_LEVEL} />
        </Sequence>
      )}
      <AbsoluteFill style={{ background: '#000', opacity: black }} />
      <Sequence name="end note" from={TOTAL_FRAMES} durationInFrames={END_NOTE_FRAMES}>
        <EndNote />
      </Sequence>
    </AbsoluteFill>
  );
}
