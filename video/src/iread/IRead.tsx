// NimbytesFeatureIRead: the iRead feature from real Mac captures (src/components/CaptureFilm.tsx).
// The cuts play in order: a bill (PDF) attached, Muse Spark reading the page, the question typed,
// the plan, the agents answering, then the answer read aloud (the app's own device voice, captured
// with the screen). Capture: public/live/iread-making.mp4. Sample bill: AER "Better Bills"
// illustrative example (CC BY 4.0, Source: AER © Commonwealth of Australia).
// The voice-over (src/iread/vo-lines.json) sets the length: the cuts are trimmed to its line.
import { CaptureFilm, filmFrames, type Cut } from '../components/CaptureFilm';
import { placeLines } from '../components/voTiming';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const MAKING = 'live/iread-making.mp4';
/** The whole iRead card (plan, progress, answer), low and right of centre, clear of the headline. */
const WHOLE_CARD = { x: 0.367, y: 0.627, zoom: 1.6 } as const;

/**
 * The cuts in order (times measured on the capture), trimmed to the voice-over: "I-Read. Just send
 * it, and it reads and understands the content for you." (0.3–3.9 s) over the bill being sent and
 * read; "Ideal for anyone with fading or blurry vision." (4.4–6.9 s) over the plan and the agents;
 * then the app reads the answer aloud from 7.3 s. Each cut overlaps the last by 10 frames, so these
 * lengths land the answer cut on frame 192 (its speech 0.9 s in). Re-speaking means re-trimming.
 */
const CUTS: readonly Cut[] = [
  // "Just send it": the bill picked in the file panel, then sent.
  // The camera pans down and eases out so the "Add a document" dialog (capture y 0.45–0.57) is
  // fully in view as the file panel (y 0.11–0.48) closes over it.
  { clip: MAKING, fromS: 18.6, toS: 21.0, start: { x: 0.47, y: 0.27, zoom: 1.5, tiltY: -7, tiltX: 4 }, end: { x: 0.44, y: 0.36, zoom: 1.45, tiltY: -2, tiltX: 1 }, label: { text: 'Send a bill or letter' } },
  // "…it reads and understands…": the bill on the right, read by Muse Spark.
  { clip: MAKING, fromS: 22.6, toS: 24.6, start: { x: 0.8, y: 0.3, zoom: 1.5, tiltY: 6, tiltX: 2 }, end: { x: 0.82, y: 0.28, zoom: 1.7, tiltY: 1 }, label: { text: 'Muse Spark reads the page' } },
  // "Ideal for anyone…": the question, and Muse Spark's plan (read, answer, read it out loud).
  { clip: MAKING, fromS: 49.8, toS: 51.6, start: { ...WHOLE_CARD, zoom: 1.52, tiltY: -6, tiltX: 3 }, end: { ...WHOLE_CARD, tiltY: -1 }, label: { text: 'Planned by Muse Spark' } },
  // "…fading or blurry vision.": Read and answer, the agents work.
  { clip: MAKING, fromS: 64.0, toS: 65.53, start: { ...WHOLE_CARD, zoom: 1.52, tiltY: 6, tiltX: 2 }, end: { ...WHOLE_CARD, tiltY: 1 }, label: { text: 'Meta AI agents at work', agents: true } },
  // The answer, read aloud: "Your amount due is $79.87. It is due on 27 April 2022."
  { clip: MAKING, fromS: 73.6, toS: 82.5, start: { ...WHOLE_CARD, zoom: 1.6, tiltY: -5, tiltX: 2 }, end: { ...WHOLE_CARD, zoom: 1.85, tiltY: 0 }, label: { text: 'Muse Spark answers', next: { atS: 0.8, text: 'Reading it aloud' } }, audio: true },
];

/** The voice-over (British female, normal speed): one line from 0.3 s. */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 0, tail: 0 }).lines;

/** The composition's length in frames. */
export const IREAD_FRAMES = filmFrames(CUTS);

export function IRead() {
  // The second headline comes in on the voice's pause, as it says "Ideal for anyone…" (4.4 s).
  const heads = [
    { first: 'Just send it,', second: 'it reads and understands it for you.', from: 0 },
    { first: 'Ideal for fading', second: 'or blurry vision.', from: 133 },
  ];
  return <CaptureFilm name="iRead" cuts={CUTS} heads={heads} vo={VO} voDir="audio/iread-vo" />;
}
