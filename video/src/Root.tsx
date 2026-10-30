// Registers the promo: 1920×1080, 30 fps, as long as the voice-over timeline (never over 3:00).
import { Composition } from 'remotion';
import { Demo } from './demo/Demo';
import { DEMO_FPS, DEMO_FRAMES } from './demo/timeline';
import { Hook, HOOK_FRAMES } from './hook/Hook';
import { IGuide, IGUIDE_FRAMES } from './iguide/IGuide';
import { FinalProductDemo, FINAL_FRAMES } from './final/FinalProductDemo';
import { Filesystem, FILESYSTEM_FRAMES } from './filesystem/Filesystem';
import { IListen, ILISTEN_FRAMES } from './ilisten/IListen';
import { IRead, IREAD_FRAMES } from './iread/IRead';
import { Intro, INTRO_FRAMES } from './intro/Intro';
import { Promo, PRODUCT_FROM } from './Promo';
import { LAYOUT } from './theme';
import { END_NOTE_FRAMES, FPS, MAX_FRAMES, TOTAL_FRAMES } from './timeline';

export function Root() {
  return (
    <>
      <Composition id="NimbytesPromo" component={Promo} width={LAYOUT.width} height={LAYOUT.height} fps={FPS} durationInFrames={Math.min(TOTAL_FRAMES + END_NOTE_FRAMES, MAX_FRAMES)} />
      {/* The product cut: no problem opener, it starts on the nimbytes introduction. */}
      <Composition id="NimbytesProduct" component={Promo} defaultProps={{ withOpener: false }} width={LAYOUT.width} height={LAYOUT.height} fps={FPS} durationInFrames={Math.min(TOTAL_FRAMES + END_NOTE_FRAMES, MAX_FRAMES) - PRODUCT_FROM} />
      {/* The demo (white page, Roboto): every scene in order, in one composition. */}
      <Composition id="DemoIntro" component={Demo} width={LAYOUT.width} height={LAYOUT.height} fps={DEMO_FPS} durationInFrames={DEMO_FRAMES} />
      {/* The nimbytes introduction, after the demo hook (same white page). */}
      <Composition id="NimbytesIntro" component={Intro} width={LAYOUT.width} height={LAYOUT.height} fps={DEMO_FPS} durationInFrames={INTRO_FRAMES} />
      {/* What nimbytes does, in one line, after the intro (same white page). */}
      <Composition id="NimbytesHook" component={Hook} width={LAYOUT.width} height={LAYOUT.height} fps={DEMO_FPS} durationInFrames={HOOK_FRAMES} />
      {/* The iGuide feature (same white page). */}
      <Composition id="NimbytesFeatureIGuide" component={IGuide} width={LAYOUT.width} height={LAYOUT.height} fps={DEMO_FPS} durationInFrames={IGUIDE_FRAMES} />
      {/* The iRead feature (real captures, full frame). */}
      <Composition id="NimbytesFeatureIRead" component={IRead} width={LAYOUT.width} height={LAYOUT.height} fps={DEMO_FPS} durationInFrames={IREAD_FRAMES} />
      {/* The iListen feature (audio translation; real captures, full frame). */}
      <Composition id="NimbytesFeatureIListen" component={IListen} width={LAYOUT.width} height={LAYOUT.height} fps={DEMO_FPS} durationInFrames={ILISTEN_FRAMES} />
      {/* The main feature: the AI-powered filesystem. */}
      <Composition id="NimbytesFeatureFilesystem" component={Filesystem} width={LAYOUT.width} height={LAYOUT.height} fps={DEMO_FPS} durationInFrames={FILESYSTEM_FRAMES} />
      {/* The full demo: every part above, back to back. */}
      <Composition id="FinalProductDemo" component={FinalProductDemo} width={LAYOUT.width} height={LAYOUT.height} fps={DEMO_FPS} durationInFrames={FINAL_FRAMES} />
    </>
  );
}
