// NimbytesFeatureIListen: the iListen feature (audio translation) from real Mac captures
// (src/components/CaptureFilm.tsx). A Japanese voicemail is dropped in; Meta Voice Transcribe and
// Muse Spark transcribe, translate and check it; Muse Image paints its cover; then the original
// plays and the English summary is read aloud (the app's own voice). Captures:
// public/live/ilisten-making.mp4 (silent: music was playing on the Mac), ilisten-play.mp4 (clean
// sound) and ilisten-cover.mp4 (a Gallery still). The voicemail was made for the demo with a macOS
// Japanese voice. The voice-over (src/ilisten/vo-lines.json) sets the length.
import { CaptureFilm, filmFrames, type Cut } from '../components/CaptureFilm';
import { placeLines } from '../components/voTiming';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const MAKING = 'live/ilisten-making.mp4';
const PLAY = 'live/ilisten-play.mp4';
const COVER = 'live/ilisten-cover.mp4';

/**
 * The cuts in order (times measured on the captures), trimmed to the voice-over: "Meet I-Listen."
 * (0.3 s); "Drop in any recording… before sending it back to you." (1.6–11.1 s) over the voicemail
 * arriving, the translation and the agent's review; "It even paints a cover with Muse Image."
 * (11.5–13.6 s) over the cover; the Japanese original's first phrase (13.7–16.1 s); "Any voice, your
 * language." (16.2–17.7 s); then the app reads the summary's first sentence in English (17.9–
 * 21.0 s). Each cut overlaps the last by 10 frames, so these lengths land each cut on its line.
 */
const CUTS: readonly Cut[] = [
  // "Meet I-Listen.": iListen > Choose a file.
  { clip: MAKING, fromS: 1.0, toS: 2.5, start: { x: 0.62, y: 0.1, zoom: 1.6, tiltY: -7, tiltX: 4 }, end: { x: 0.64, y: 0.1, zoom: 1.75, tiltY: -2, tiltX: 1 }, label: { text: 'Drop in any recording' } },
  // "…hears who's speaking and in which language": the voicemail arrives, Meta Voice Transcribe runs.
  { clip: MAKING, fromS: 9.6, toS: 14.6, start: { x: 0.86, y: 0.2, zoom: 2.0, tiltY: 6, tiltX: 2 }, end: { x: 0.87, y: 0.19, zoom: 2.2, tiltY: 1 }, label: { text: 'Meta Voice Transcribe hears it', agents: true } },
  // "…translates every word into yours": what was said, in English with the Japanese under it.
  { clip: PLAY, fromS: 0.2, toS: 2.2, start: { x: 0.86, y: 0.86, zoom: 1.9, tiltY: -6, tiltX: -2 }, end: { x: 0.87, y: 0.88, zoom: 2.05, tiltY: -1 }, label: { text: 'Translated into English' } },
  // "…and the agent reviews the translation result…": every line checked, 100%.
  { clip: MAKING, fromS: 50.0, toS: 53.45, start: { x: 0.86, y: 0.25, zoom: 2.0, tiltY: 6, tiltX: 2 }, end: { x: 0.87, y: 0.27, zoom: 2.15, tiltY: 1 }, label: { text: 'Reviewed by the Muse Spark agent: 100%' } },
  // "It even paints a cover with Muse Image.": the voicemail's cover in the Gallery.
  { clip: COVER, fromS: 0, toS: 3.3, start: { x: 0.155, y: 0.22, zoom: 3.0, tiltY: -5, tiltX: 3 }, end: { x: 0.155, y: 0.22, zoom: 3.25, tiltY: 0 }, label: { text: 'Cover painted by Muse Image' } },
  // The original's first phrase (Japanese), then quiet under "Any voice, your language."
  { clip: PLAY, fromS: 2.2, toS: 6.4, audioUntilS: 4.85, start: { x: 0.86, y: 0.62, zoom: 1.9, tiltY: 5, tiltX: -2 }, end: { x: 0.87, y: 0.64, zoom: 2.05, tiltY: 0 }, label: { text: 'The original, in Japanese' }, audio: true },
  // Read it to me: the summary's first sentence, in English.
  { clip: PLAY, fromS: 17.6, toS: 21.25, start: { x: 0.86, y: 0.42, zoom: 1.9, tiltY: -5, tiltX: 2 }, end: { x: 0.87, y: 0.45, zoom: 2.05, tiltY: 0 }, label: { text: 'Read aloud in English' }, audio: true },
];

/** The voice-over (British female, normal speed): four lines, gaps set so each lands on its cut. */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 0.35, tail: 0, gaps: [0.35, 0.36, 2.7] }).lines;

/** The composition's length in frames. */
export const ILISTEN_FRAMES = filmFrames(CUTS);

export function IListen() {
  const heads = [
    { first: 'Any recording,', second: 'any language.', from: 0 },
    { first: 'Translated, then reviewed', second: 'by the agent.', from: 175 },
    { first: 'A cover,', second: 'painted by Muse Image.', from: VO[2]?.from ?? 0 },
    { first: 'Any voice,', second: 'your language.', from: VO[3]?.from ?? 0 },
  ];
  return <CaptureFilm name="iListen" cuts={CUTS} heads={heads} vo={VO} voDir="audio/ilisten-vo" note="Sample voicemail made for this demo with a macOS Japanese voice." />;
}
