// The whole promo: the scenes from the timeline (each crossfading over the one before), the
// British voice-over line by line, the music raw (its own level, no ducking or fades; from when nimbytes is shown, once, no loop),  and a fade to black at the end.
import type { ComponentType } from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { hasAsset } from './components/assets';
import { CloseScene, GlassesScene, ModelsScene } from './promo/CloseScenes';
import type { SceneProps } from './promo/parts';
import { IGuideScene, IReadScene, MeetScene, SearchScene, UnderstandScene, ZeroScene } from './promo/ProductScenes';
import { BridgeScene, CareScene, CreatorsScene, DementiaScene, HookScene, PriceScene, WhatIfScene } from './promo/StoryScenes';
import { LINES, TIMELINE, TOTAL_FRAMES, type SceneId } from './timeline';

const SCENES: Readonly<Record<SceneId, ComponentType<SceneProps>>> = {
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
  iguide: IGuideScene,
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


/** Music level: one fixed, lower level under the voice (no ducking or fades). */
const MUSIC_LEVEL = 0.35;

/** The music starts on the first frame, with nimbytes, and plays once, never looped. */
const MUSIC_FROM = 0;
/** The track's length in frames (136 s). */
const MUSIC_FRAMES = Math.round(136 * 30);


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
      {hasAsset('audio/music.mp3') && (
        <Sequence name="music" from={MUSIC_FROM} durationInFrames={MUSIC_FRAMES}>
          <Audio src={staticFile('audio/music.mp3')} volume={MUSIC_LEVEL} />
        </Sequence>
      )}
      <AbsoluteFill style={{ background: '#000', opacity: black }} />
    </AbsoluteFill>
  );
}
