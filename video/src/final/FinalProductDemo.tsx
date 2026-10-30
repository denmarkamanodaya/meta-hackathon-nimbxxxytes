// FinalProductDemo: the full demo, every composition back to back in order: the problem (Demo),
// the nimbytes introduction, the hook, then the features: filesystem, iListen, iGuide, iRead.
// Each part keeps its own voice-over and length; a part changes only in its own file. Background
// music plays under the whole demo.
import type { ComponentType } from 'react';
import { Audio, interpolate, Series, staticFile } from 'remotion';
import { Demo } from '../demo/Demo';
import { DEMO_FRAMES } from '../demo/timeline';
import { Filesystem, FILESYSTEM_FRAMES } from '../filesystem/Filesystem';
import { Hook, HOOK_FRAMES } from '../hook/Hook';
import { IGuide, IGUIDE_FRAMES } from '../iguide/IGuide';
import { IListen, ILISTEN_FRAMES } from '../ilisten/IListen';
import { Intro, INTRO_FRAMES } from '../intro/Intro';
import { IRead, IREAD_FRAMES } from '../iread/IRead';

/** The parts in order, with their lengths in frames. */
const PARTS: readonly { id: string; Part: ComponentType; frames: number }[] = [
  { id: 'demo', Part: Demo, frames: DEMO_FRAMES },
  { id: 'intro', Part: Intro, frames: INTRO_FRAMES },
  { id: 'hook', Part: Hook, frames: HOOK_FRAMES },
  { id: 'filesystem', Part: Filesystem, frames: FILESYSTEM_FRAMES },
  { id: 'ilisten', Part: IListen, frames: ILISTEN_FRAMES },
  { id: 'iguide', Part: IGuide, frames: IGUIDE_FRAMES },
  { id: 'iread', Part: IRead, frames: IREAD_FRAMES },
];

/** The full demo's length in frames. */
export const FINAL_FRAMES = PARTS.reduce((sum, part) => sum + part.frames, 0);

/** Background music level under the voice (one fixed level, short fades at the ends). */
const BGM_LEVEL = 0.25;

export function FinalProductDemo() {
  const bgmVolume = (f: number) => BGM_LEVEL * interpolate(f, [0, 30, FINAL_FRAMES - 60, FINAL_FRAMES], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
    {/* Background music: public/audio/bgm-final.mp3 (owner's track), looped if shorter than the demo. */}
    <Audio src={staticFile('audio/bgm-final.mp3')} volume={bgmVolume} loop />
    <Series>
      {PARTS.map(({ id, Part, frames }) => (
        <Series.Sequence key={id} durationInFrames={frames}>
          <Part />
        </Series.Sequence>
      ))}
    </Series>
    </>
  );
}
