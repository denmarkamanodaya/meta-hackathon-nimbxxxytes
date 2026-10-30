// Plays a Memory Lane moment in the page's <video>: from its start second to its end second, its
// own sound low under the voice. `playMoment` calls `play()` at once, so the first one must run
// inside a tap (iOS refuses playback started outside a user gesture); later ones follow the tap
// that moved the session on.
//
// The window holds whatever the element does: a seek set before a new source has its metadata is
// dropped by WebKit (the Mac app and iOS), so the start second is applied once metadata is in, and
// every time update puts playback back inside start..end (a lost seek is redone, and playback past
// the end, even after something resumed it, is paused again) until the next moment or stop.

/** `HTMLMediaElement.HAVE_METADATA`: duration and size are known, a seek can land. */
const HAVE_METADATA = 1;

/** How far before the start a time update may read before the seek counts as lost, seconds. */
const BEFORE_START_S = 0.5;

/** The parts of a video element the moment player uses; tests pass a fake. */
export interface MomentTarget {
  currentTime: number;
  volume: number;
  readonly readyState: number;
  readonly paused: boolean;
  ontimeupdate: ((event: Event) => unknown) | null;
  onloadedmetadata: ((event: Event) => unknown) | null;
  play: () => Promise<void>;
  pause: () => void;
}

/** One moment's window and loudness. */
export interface MomentPlay {
  start: number;
  end: number;
  /** 0–1. */
  volume: number;
}

/**
 * Plays the window once and holds its last frame.
 * @param video - The page's video element.
 * @param play - Where and how loud.
 */
export function playMoment(video: MomentTarget, { start, end, volume }: MomentPlay): void {
  const seekToStart = () => {
    video.currentTime = start;
  };
  video.volume = volume;
  video.onloadedmetadata = null;
  if (video.readyState >= HAVE_METADATA) {
    seekToStart();
  } else {
    video.onloadedmetadata = () => {
      video.onloadedmetadata = null;
      seekToStart();
    };
  }
  video.ontimeupdate = () => {
    if (video.readyState < HAVE_METADATA) return;
    if (video.currentTime >= end) {
      if (!video.paused) video.pause();
    } else if (video.currentTime < start - BEFORE_START_S) {
      seekToStart();
    }
  };
  video.play().catch(() => {
    // Recovers: autoplay can be refused; the first frame of the moment still shows.
  });
}

/**
 * Pauses the moment and drops its watchers.
 * @param video - The page's video element.
 */
export function stopMoment(video: MomentTarget): void {
  video.ontimeupdate = null;
  video.onloadedmetadata = null;
  video.pause();
}
