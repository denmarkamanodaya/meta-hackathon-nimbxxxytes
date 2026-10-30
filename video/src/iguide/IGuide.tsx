// NimbytesFeatureIGuide: the iGuide feature, built scene by scene on the white page (Roboto, deck
// ink). Empty for now: scenes are added as they are designed.
import { AbsoluteFill } from 'remotion';
import { COLOR } from '../theme';

/** The composition's length in frames, at 30 fps, until its scenes set it. */
export const IGUIDE_FRAMES = 90;

export function IGuide() {
  return <AbsoluteFill style={{ background: COLOR.white }} />;
}
