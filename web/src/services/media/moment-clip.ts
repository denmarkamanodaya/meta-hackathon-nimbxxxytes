// Plays a Memory Lane moment in the page's <video>: from its start second to its end second, its
// own sound low under the voice. `playMoment` calls `play()` at once, so the first one must run
// inside a tap (iOS refuses playback started outside a user gesture); later ones follow the tap
// that moved the session on.

/** The parts of a video element the moment player uses; tests pass a fake. */
export interface MomentTarget {
  currentTime: number;
  volume: number;
  ontimeupdate: ((event: Event) => unknown) | null;
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
  video.volume = volume;
  video.currentTime = start;
  video.ontimeupdate = () => {
    if (video.currentTime < end) return;
    video.ontimeupdate = null;
    video.pause();
  };
  video.play().catch(() => {
    // Recovers: autoplay can be refused; the first frame of the moment still shows.
  });
}

/**
 * Pauses the moment and drops its end watcher.
 * @param video - The page's video element.
 */
export function stopMoment(video: MomentTarget): void {
  video.ontimeupdate = null;
  video.pause();
}
