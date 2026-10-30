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
 * The cuts in order (times measured on the captures), trimmed to the voice-over: "I-Listen."
 * (0.3 s); "Drop in any recording… before sending it back to you." (1.6–11.1 s) over the voicemail
 * arriving, the translation and the agent's review; "It even paints a cover with Muse Image."
 * (11.5–13.6 s) over the cover; the Japanese original's first phrase (13.7–16.1 s); "Any voice, your
 * language." (16.2–17.7 s); then the app reads the summary's first sentence in English (17.9–
 * 21.0 s). Each cut overlaps the last by 10 frames, so these lengths land each cut on its line.
 */
/** The right-hand panel (title, steps, summary) with the list beside it, at a readable size. */
const PANEL = (y: number) => ({ x: 0.74, y, zoom: 1.45 });
/** A gentle push-in on one framing: same centre, 4% closer. No pan. */
const hold = (frame: { x: number; y: number; zoom: number }) => ({ start: frame, end: { ...frame, zoom: frame.zoom * 1.04 } });

const CUTS: readonly Cut[] = [
  // "I-Listen.": the iListen page, Choose a file.
  { clip: MAKING, fromS: 1.0, toS: 2.5, ...hold({ x: 0.6, y: 0.3, zoom: 1.25 }), label: { text: 'Drop in any recording' } },
  // "…hears who's speaking and in which language": the voicemail arrives, Meta Voice Transcribe runs.
  { clip: MAKING, fromS: 9.6, toS: 14.6, ...hold(PANEL(0.3)), label: { text: 'Meta Voice Transcribe hears it', agents: true } },
  // "…translates every word into yours": what was said, in English with the Japanese under it.
  { clip: PLAY, fromS: 0.2, toS: 2.2, ...hold(PANEL(0.72)), label: { text: 'Translated into English' } },
  // "…and the agent reviews the translation result…": every line checked, 100%.
  { clip: MAKING, fromS: 50.0, toS: 53.45, ...hold(PANEL(0.3)), label: { text: 'Reviewed by the Muse Spark agent: 100%' } },
  // "It even paints a cover with Muse Image.": the voicemail's cover in the Gallery. Still: no move.
  { clip: COVER, fromS: 0, toS: 3.3, start: { x: 0.2, y: 0.22, zoom: 2.0 }, end: { x: 0.2, y: 0.22, zoom: 2.0 }, label: { text: 'Cover painted by Muse Image' } },
  // The original's first phrase (Japanese), then quiet under "Any voice, your language."
  { clip: PLAY, fromS: 2.2, toS: 6.4, audioUntilS: 4.85, ...hold(PANEL(0.62)), label: { text: 'The original, in Japanese' }, audio: true },
  // Read it to me: the summary's first sentence, in English.
  { clip: PLAY, fromS: 17.6, toS: 21.25, ...hold(PANEL(0.45)), label: { text: 'Read aloud in English' }, audio: true },
];

/** The voice-over (British female, normal speed): four lines, gaps set so each lands on its cut. */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 0.35, tail: 0, gaps: [0.7, 0.36, 2.7] }).lines;

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
