// NimbytesFeatureFilesystem: the main feature, the AI-powered filesystem, from the owner's screen
// recording (src/components/CaptureFilm.tsx): a 3.4 GB clip is shown in Finder, Get Info says
// "Zero bytes on disk", then it opens in nimbytes and scrubs instantly (the smart cache streams only
// what you watch). Capture: public/live/fs-owner.mp4 (silent). DRAFT: no voice-over or headlines
// yet; the cuts are trimmed to the script once it is set.
import { CaptureFilm, filmFrames, type Cut } from '../components/CaptureFilm';

const CLIP = 'live/fs-owner.mp4';
/** The player (video and timeline), with the speech list beside it. */
const PLAYER = { x: 0.46, y: 0.31, zoom: 1.3 } as const;

/** The cuts in order (times measured on the capture). */
const CUTS: readonly Cut[] = [
  // Gallery: right-click the 3.4 GB "60th birthday celebration" > Show in Finder.
  { clip: CLIP, fromS: 0.9, toS: 2.7, start: { x: 0.22, y: 0.6, zoom: 1.7, tiltY: -7, tiltX: 4 }, end: { x: 0.21, y: 0.66, zoom: 1.9, tiltY: -2, tiltX: 1 }, label: { text: 'Show in Finder' } },
  // Finder: the clip in the nimbytes drive, then Get Info.
  { clip: CLIP, fromS: 3.0, toS: 5.4, start: { x: 0.35, y: 0.5, zoom: 1.3, tiltY: 6, tiltX: 2 }, end: { x: 0.3, y: 0.55, zoom: 1.5, tiltY: 1 }, label: { text: 'A 3.4 GB video' } },
  // Get Info: "3,403,757,823 bytes (Zero bytes on disk)".
  { clip: CLIP, fromS: 5.5, toS: 8.4, start: { x: 0.1, y: 0.16, zoom: 1.9, tiltY: -6, tiltX: 3 }, end: { x: 0.1, y: 0.16, zoom: 2.2, tiltY: 0 }, label: { text: 'Zero bytes on disk' } },
  // Back in nimbytes: it opens and plays, streaming.
  { clip: CLIP, fromS: 9.6, toS: 11.0, start: { ...PLAYER, zoom: 1.2, tiltY: 5, tiltX: 2 }, end: { ...PLAYER, tiltY: 1 }, label: { text: 'Opens at once, streaming' } },
  // Fast scrubbing: every jump lands immediately.
  { clip: CLIP, fromS: 11.0, toS: 16.7, start: { ...PLAYER, tiltY: -5, tiltX: 2 }, end: { ...PLAYER, zoom: 1.45, tiltY: 0 }, label: { text: 'Smart cache: every jump is instant' } },
  // Plays on, like a local file.
  { clip: CLIP, fromS: 16.7, toS: 19.5, start: { ...PLAYER, zoom: 1.45, tiltY: 4 }, end: { ...PLAYER, zoom: 1.55, tiltY: 0 }, label: { text: 'Plays like it is on your Mac' } },
];

/** The composition's length in frames. */
export const FILESYSTEM_FRAMES = filmFrames(CUTS);

export function Filesystem() {
  return <CaptureFilm name="nimbytes" cuts={CUTS} heads={[]} vo={[]} voDir="audio/filesystem-vo" />;
}
