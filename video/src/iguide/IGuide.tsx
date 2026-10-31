// NimbytesFeatureIGuide: the iGuide feature from real Mac captures (src/components/CaptureFilm.tsx).
// The cuts play in order: a clip attached and the request typed, Muse Spark's plan, Make iGuide and
// the agents running to Ready, then the finished guide reading step 1 aloud (the app's own device
// voice, captured with the screen). Captures: public/live/iguide-*.mp4. The voice-over
// (src/iguide/vo-lines.json) sets the length: the cuts are trimmed to its lines.
import { AbsoluteFill, Audio, Sequence, Series, staticFile } from 'remotion';
import { wordsOf } from '../captions';
import { CaptureFilm, filmFrames, type Cut } from '../components/CaptureFilm';
import { UsesRoll, useStarts } from '../components/UsesRoll';
import { COLOR } from '../theme';
import { placeLines } from '../components/voTiming';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const MAKING = 'live/iguide-making.mp4';
const READ = 'live/iguide-read-aloud.mp4';
/**
 * The whole iGuide card (plan, progress, Ready: capture x 0.28–0.66, y 0.57–0.89) in view, low and
 * right of centre so it sits under and beside the headline, never cut off at the bottom.
 */
const WHOLE_CARD = { x: 0.367, y: 0.627, zoom: 1.6 } as const;

/**
 * The cuts in order (times measured on the captures), trimmed to the voice-over: line 1 (7.2 s,
 * from 0.3 s) runs over attaching and typing; line 2 (5.5 s, from 7.9 s) over the plan, the agents
 * and Ready; a short beat later the guide reads step 1 aloud. Each cut overlaps the last by
 * DISSOLVE, so the cut lengths here are what land each join on its line. Re-speaking a line means
 * re-trimming. Framings are tight on the part that matters (fractions of the capture), with the
 * subject right of centre and low, clear of the headline top left.
 */
const CUTS: readonly Cut[] = [
  // The Add clips dialog: "Seasoning chicken breasts" ticked.
  { clip: MAKING, fromS: 4.6, toS: 7.6, start: { x: 0.43, y: 0.36, zoom: 1.9, tiltY: -7, tiltX: 4 }, end: { x: 0.44, y: 0.35, zoom: 2.1, tiltY: -2, tiltX: 1 }, label: { text: 'Attach a clip' } },
  // The request typed into iRecall.
  { clip: MAKING, fromS: 7.6, toS: 12.8, start: { x: 0.36, y: 0.95, zoom: 2.5, tiltY: 6, tiltX: -3 }, end: { x: 0.46, y: 0.95, zoom: 2.6, tiltY: 1, tiltX: 0 }, label: { text: 'Ask in plain words' } },
  // Sent: Muse Spark plans the guide (4 steps and the models that run them).
  { clip: MAKING, fromS: 26.4, toS: 28.6, start: { ...WHOLE_CARD, zoom: 1.52, tiltY: -6, tiltX: 3 }, end: { ...WHOLE_CARD, tiltY: -1 }, label: { text: 'Planned by Muse Spark' } },
  // Make iGuide: the agents start, step 1 of 4.
  { clip: MAKING, fromS: 41.0, toS: 43.0, start: { ...WHOLE_CARD, zoom: 1.52, tiltY: 6, tiltX: 2 }, end: { ...WHOLE_CARD, tiltY: 1 }, label: { text: 'Meta AI agents at work', agents: true } },
  // Ready: all 4 steps done.
  { clip: MAKING, fromS: 90.6, toS: 92.5, start: { ...WHOLE_CARD, zoom: 1.52, tiltY: -5, tiltX: -2 }, end: WHOLE_CARD, label: { text: 'Steps · frames · SAM 3.1 · voice', agents: true } },
  // The guide: step 1 with SAM's outline, then read aloud (the app's own voice).
  { clip: READ, fromS: 2.4, toS: 7.4, start: { x: 0.34, y: 0.26, zoom: 1.7, tiltY: 6, tiltX: 3 }, end: { x: 0.4, y: 0.29, zoom: 2.0, tiltY: 0 }, label: { text: 'SAM 3.1 outlines the step', next: { atS: 1.1, text: 'Reading it aloud' } }, audio: true },
];

/** The voice-over (British female, normal speed): two lines, timed as the cuts above. */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 0.4, tail: 0 }).lines;

/**
 * The closing scene: the promo's uses line and roll ("Or use it to show someone how to do the
 * laundry, fix a leaky tap…") on the white page (also the hero demo's iGuide ending), voice public/audio/vo/uses-1.wav (6.48 s) from 0.3 s, a short hold.
 */
const USES_LINE = { id: 'uses-1', scene: 'uses' as const, text: 'Or use it to show someone how to do the laundry, fix a leaky tap, make a video call, use the TV remote, or reset the Wi-Fi.', from: 9, durationInFrames: Math.round(6.481 * 30) };
export const USES_FRAMES = USES_LINE.from + USES_LINE.durationInFrames + 30;

export function UsesEnd() {
  const starts = useStarts(wordsOf(USES_LINE));
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      <div style={{ position: 'absolute', left: 160, right: 120, top: 480 }}>
        <UsesRoll starts={starts} leadColor={COLOR.ink} taskColor={COLOR.teal} />
      </div>
      <Sequence from={USES_LINE.from} durationInFrames={USES_LINE.durationInFrames}>
        <Audio src={staticFile('audio/vo/uses-1.wav')} />
      </Sequence>
    </AbsoluteFill>
  );
}

const FILM_FRAMES = filmFrames(CUTS);

/** The composition's length in frames: the film, then the uses scene. */
export const IGUIDE_FRAMES = FILM_FRAMES + USES_FRAMES;

export function IGuide() {
  const heads = [
    { first: 'Turn any video into', second: 'clear, step-by-step instructions.', from: 0 },
    { first: 'A step-by-step workflow', second: 'to complete, read aloud.', from: VO[1]?.from ?? 0 },
  ];
  return (
    <Series>
      <Series.Sequence durationInFrames={FILM_FRAMES}>
        <CaptureFilm name="iGuide" cuts={CUTS} heads={heads} vo={VO} voDir="audio/iguide-vo" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={USES_FRAMES}>
        <UsesEnd />
      </Series.Sequence>
    </Series>
  );
}
