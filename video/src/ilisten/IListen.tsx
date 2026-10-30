// NimbytesFeatureIListen: the iListen feature (audio translation) from real Mac captures
// (src/components/CaptureFilm.tsx). A Japanese voicemail is chosen, Meta Voice Transcribe and Muse
// Spark transcribe, translate and check it, then the original plays and the English summary is read
// aloud (the app's own voice). Captures: public/live/ilisten-making.mp4 (silent: music was playing
// on the Mac) and public/live/ilisten-play.mp4 (clean sound). The voicemail was made for the demo
// with a macOS Japanese voice.
// DRAFT timing: waits on the voice-over script; the cuts are then trimmed to its lines.
import { CaptureFilm, filmFrames, type Cut } from '../components/CaptureFilm';

const MAKING = 'live/ilisten-making.mp4';
const PLAY = 'live/ilisten-play.mp4';

/** The cuts in order (times measured on the captures). */
const CUTS: readonly Cut[] = [
  // iListen > Choose a file (the file panel itself is skipped: it still showed another folder).
  { clip: MAKING, fromS: 1.0, toS: 3.3, start: { x: 0.62, y: 0.1, zoom: 1.6, tiltY: -7, tiltX: 4 }, end: { x: 0.64, y: 0.1, zoom: 1.75, tiltY: -2, tiltX: 1 }, label: { text: 'Send a recording, any language' } },
  // The voicemail arrives; the steps: Audio, Transcribe (Meta Voice Transcribe), Understand (Muse Spark), Check, Cover, Voice.
  { clip: MAKING, fromS: 9.6, toS: 17.0, start: { x: 0.86, y: 0.2, zoom: 2.0, tiltY: 6, tiltX: 2 }, end: { x: 0.87, y: 0.19, zoom: 2.2, tiltY: 1 }, label: { text: 'Meta AI agents at work', agents: true } },
  // Heard Japanese 100%, every line checked 100%.
  { clip: MAKING, fromS: 21.0, toS: 25.0, start: { x: 0.86, y: 0.22, zoom: 1.9, tiltY: -6, tiltX: 3 }, end: { x: 0.87, y: 0.24, zoom: 2.05, tiltY: -1 }, label: { text: 'Every line checked by Muse Spark' } },
  // The original plays (Japanese).
  { clip: PLAY, fromS: 2.0, toS: 8.0, start: { x: 0.86, y: 0.75, zoom: 1.8, tiltY: 6, tiltX: -2 }, end: { x: 0.87, y: 0.78, zoom: 1.95, tiltY: 1 }, label: { text: 'The original, in Japanese' }, audio: true },
  // Read it to me: the English summary, read aloud.
  { clip: PLAY, fromS: 17.4, toS: 38.0, start: { x: 0.86, y: 0.42, zoom: 1.8, tiltY: -5, tiltX: 2 }, end: { x: 0.87, y: 0.45, zoom: 2.0, tiltY: 0 }, label: { text: 'Read aloud in English' }, audio: true },
];

/** The composition's length in frames. */
export const ILISTEN_FRAMES = filmFrames(CUTS);

export function IListen() {
  const heads = [
    { first: 'Any language,', second: 'understood for you.', from: 0 },
    { first: 'Translated, checked,', second: 'read aloud.', from: 390 },
  ];
  return <CaptureFilm name="iListen" cuts={CUTS} heads={heads} vo={[]} voDir="audio/ilisten-vo" note="Sample voicemail made for this demo with a macOS Japanese voice." />;
}
