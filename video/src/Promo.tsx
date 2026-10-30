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
import { END_NOTE_FRAMES, LINES, REAL_NOTE_FRAMES, sceneOf, TIMELINE, TOTAL_FRAMES, type SceneId } from './timeline';
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


/** One quiet white line, bottom right, fading in (and out unless it is the last). */
function NoteLine({ text, length }: { text: string; length?: number }) {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [6, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = length === undefined ? 1 : interpolate(frame, [length - 12, length], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', right: 96, bottom: 80, fontFamily: INTER, fontWeight: 300, fontSize: 30, color: '#FFFFFF', opacity: fadeIn * fadeOut }}>
      {text}
    </div>
  );
}

/** After the fade to black: "Real footage. Real test.", then the pairing note. */
function EndNote() {
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence durationInFrames={REAL_NOTE_FRAMES} layout="none">
        <NoteLine text="Real footage. Real test." length={REAL_NOTE_FRAMES} />
      </Sequence>
      <Sequence from={REAL_NOTE_FRAMES} layout="none">
        <NoteLine text="nimbytes is better paired with vision ingestion, such as Meta AI glasses." />
      </Sequence>
    </AbsoluteFill>
  );
}

/** Lines without a subtitle: the nimbytes introduction, the closing name, and the app's own voice (on screen already). */
const NO_SUBTITLE: readonly string[] = ['meet-1', 'close-1', 'close-2'];

/** The spoken line as a subtitle, low and centred, white over soft shadows (no band). */
function Subtitle({ text, length }: { text: string; length: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 6, length - 6, length], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 40 }}>
      <div style={{ maxWidth: 1400, textAlign: 'center', fontFamily: INTER, fontWeight: 400, fontSize: 36, lineHeight: 1.3, color: '#FFFFFF', textShadow: '0 2px 8px rgba(0,0,0,0.95), 0 0 3px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.6)', opacity }}>
        {text}
      </div>
    </AbsoluteFill>
  );
}

/** The two problem scenes that open the full cut; the product cut leaves them out. */
const OPENER: readonly SceneId[] = ['p-both', 'p-whatif'];
/** Where the product cut starts on the full timeline: the nimbytes introduction. */
export const PRODUCT_FROM = MUSIC_FROM;

/**
 * The promo. `withOpener` false gives the product cut: it drops the problem scenes, their lines
 * and their music, and starts on the nimbytes introduction.
 */
export function Promo({ withOpener = true }: { withOpener?: boolean }) {
  const shift = withOpener ? 0 : PRODUCT_FROM;
  const scenes = withOpener ? TIMELINE : TIMELINE.filter((scene) => !OPENER.includes(scene.id));
  const lines = withOpener ? LINES : LINES.filter((line) => line.from >= PRODUCT_FROM);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={-shift} layout="none">
        <Cut scenes={scenes} lines={lines} withOpener={withOpener} />
      </Sequence>
    </AbsoluteFill>
  );
}

function Cut({ scenes, lines, withOpener }: { scenes: typeof TIMELINE; lines: typeof LINES; withOpener: boolean }) {
  const frame = useCurrentFrame();
  const black = interpolate(frame, [TOTAL_FRAMES - 15, TOTAL_FRAMES - 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {scenes.map((scene, index) => {
        const Scene = SCENES[scene.id];
        const isLast = index === scenes.length - 1;
        return (
          <Sequence key={scene.id} name={scene.id} from={scene.from} durationInFrames={scene.durationInFrames + (isLast ? 0 : CROSSFADE)}>
            <Fade isFirst={index === 0} isLast={isLast} length={scene.durationInFrames + (isLast ? 0 : CROSSFADE)}>
              <Scene scene={scene} />
            </Fade>
          </Sequence>
        );
      })}
      {lines.filter((line) => hasAsset(`audio/vo/${line.id}.wav`)).map((line) => (
        <Sequence key={line.id} name={`vo ${line.id}`} from={line.from} durationInFrames={line.durationInFrames + 15}>
          <Audio src={staticFile(`audio/vo/${line.id}.wav`)} />
        </Sequence>
      ))}
      {withOpener && hasAsset('audio/music-problem.mp3') && (
        <Sequence name="music-problem" from={0} durationInFrames={MUSIC_FROM}>
          <Audio src={staticFile('audio/music-problem.mp3')} trimBefore={PROBLEM_MUSIC_SKIP} volume={(f) => MUSIC_LEVEL * interpolate(f, [MUSIC_FROM - 15, MUSIC_FROM], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
        </Sequence>
      )}
      {hasAsset('audio/music.mp3') && (
        <Sequence name="music" from={MUSIC_FROM} durationInFrames={MUSIC_FRAMES}>
          <Audio src={staticFile('audio/music.mp3')} volume={MUSIC_LEVEL} />
        </Sequence>
      )}
      {lines.filter((line) => line.voice !== 'device' && !NO_SUBTITLE.includes(line.id)).map((line) => (
        <Sequence key={`sub ${line.id}`} name={`sub ${line.id}`} from={line.from} durationInFrames={line.durationInFrames + 6}>
          <Subtitle text={line.text} length={line.durationInFrames + 6} />
        </Sequence>
      ))}
      <AbsoluteFill style={{ background: '#000', opacity: black }} />
      <Sequence name="end note" from={TOTAL_FRAMES} durationInFrames={END_NOTE_FRAMES}>
        <EndNote />
      </Sequence>
    </AbsoluteFill>
  );
}
