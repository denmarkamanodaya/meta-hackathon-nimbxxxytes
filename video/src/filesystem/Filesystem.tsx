// NimbytesFeatureFilesystem: the main feature, the AI-powered filesystem, from the owner's screen
// recording, uncut (src/components/CaptureFilm.tsx): the right-click in the Gallery, Show in Finder
// on a 3.4 GB clip, Get Info ("Zero bytes on disk"), then it opens in nimbytes and scrubs instantly
// (the smart cache streams only what you watch). One continuous shot; the camera only zooms and
// pans. Capture: public/live/fs-owner.mp4 (silent). The voice-over is in src/filesystem/vo-lines.json.
import { CaptureFilm, filmFrames, type Cut } from '../components/CaptureFilm';
import { placeLines } from '../components/voTiming';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const CLIP = 'live/fs-owner.mp4';
/** The player (video and timeline), with the speech list beside it. */
const PLAYER = { x: 0.46, y: 0.31, zoom: 1.3 } as const;

/**
 * The shot: 1.98–13.7 s of the capture, uncut (it opens on the Show in Finder menu and stops
 * mid-scrub), with no pills. Camera keyframes are in seconds from the shot's start (capture time
 * minus 1.98).
 */
const SHOT: Cut = {
  clip: CLIP,
  fromS: 1.98,
  toS: 13.7,
  start: { x: 0.215, y: 0.62, zoom: 1.67 },
  end: { ...PLAYER, zoom: 1.4 },
  keys: [
    // Gallery: right-click the clip > Show in Finder.
    { atS: 0, x: 0.215, y: 0.62, zoom: 1.67 },
    { atS: 0.52, x: 0.21, y: 0.65, zoom: 1.75 },
    // Finder: the 3.4 GB file, right-click > Get Info.
    { atS: 1.52, x: 0.34, y: 0.52, zoom: 1.3 },
    { atS: 3.22, x: 0.3, y: 0.55, zoom: 1.4 },
    // Get Info: "3,403,757,823 bytes (Zero bytes on disk)".
    { atS: 3.92, x: 0.1, y: 0.16, zoom: 2.0 },
    { atS: 5.52, x: 0.1, y: 0.16, zoom: 2.2 },
    // Back to nimbytes, wide, as it opens.
    { atS: 6.52, x: 0.5, y: 0.5, zoom: 1.05 },
    // The player: it opens, streams, and every jump lands at once.
    { atS: 8.22, ...PLAYER, zoom: 1.25 },
    { atS: 11.72, ...PLAYER, zoom: 1.4 },
  ],
};

/**
 * The voice-over (British female, normal speed): "This video is 3.4 gigabytes," as Finder shows the
 * file (1.1 s), "and takes zero bytes on your disk." on Get Info, then "Open it…" as it opens (7.6 s).
 */
const VO = placeLines(lines, generated, { min: 0, lead: 1.12, gap: 2.45, tail: 0 }).lines;

/** The composition's length in frames. */
export const FILESYSTEM_FRAMES = filmFrames([SHOT]);

export function Filesystem() {
  return <CaptureFilm name="nimbytes" cuts={[SHOT]} heads={[]} vo={VO} voDir="audio/filesystem-vo" />;
}
