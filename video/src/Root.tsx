// Registers the promo: 1920×1080, 30 fps, as long as the voice-over timeline (never over 3:00).
import { Composition } from 'remotion';
import { Promo } from './Promo';
import { LAYOUT } from './theme';
import { END_NOTE_FRAMES, FPS, MAX_FRAMES, TOTAL_FRAMES } from './timeline';

export function Root() {
  return <Composition id="NimbytesPromo" component={Promo} width={LAYOUT.width} height={LAYOUT.height} fps={FPS} durationInFrames={Math.min(TOTAL_FRAMES + END_NOTE_FRAMES, MAX_FRAMES)} />;
}
