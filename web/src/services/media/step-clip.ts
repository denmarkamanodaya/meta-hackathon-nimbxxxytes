// Plays a guide step's short clip once, muted, in the page's <video> (the clip half of ▶ Play).
// `startClip` calls `element.play()` at once, so it must run inside the tap handler, as the voice
// does (iOS refuses playback started outside a user gesture).

/** The parts of a video element the clip player uses; tests pass a fake. */
export interface ClipTarget {
  currentTime: number;
  onended: ((event: Event) => unknown) | null;
  play: () => Promise<void>;
  pause: () => void;
}

/**
 * Plays the clip from the start.
 * @param clip - The step's video element.
 * @param onEnd - Called once when the clip ends or the browser refuses to play it.
 */
export function startClip(clip: ClipTarget, onEnd: () => void): void {
  let isEnded = false;
  const end = () => {
    if (isEnded) return;
    isEnded = true;
    onEnd();
  };
  clip.onended = end;
  clip.currentTime = 0;
  // Recovers: the browser refused the clip or it failed to load; Play goes on with the voice alone.
  clip.play().catch(end);
}

/**
 * Pauses the clip without calling its pending `onEnd`.
 * @param clip - The step's video element.
 */
export function stopClip(clip: ClipTarget): void {
  clip.onended = null;
  clip.pause();
}
