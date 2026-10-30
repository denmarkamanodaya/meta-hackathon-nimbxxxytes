// FinalProductDemo: the full demo, every composition back to back in order: the problem (Demo),
// the nimbytes introduction, the hook, then the features: filesystem, iListen, iGuide, iRead.
// Each part keeps its own voice-over and length; a part changes only in its own file.
import type { ComponentType } from 'react';
import { Series } from 'remotion';
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

export function FinalProductDemo() {
  return (
    <Series>
      {PARTS.map(({ id, Part, frames }) => (
        <Series.Sequence key={id} durationInFrames={frames}>
          <Part />
        </Series.Sequence>
      ))}
    </Series>
  );
}
