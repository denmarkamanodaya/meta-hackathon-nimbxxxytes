// Player control for the clip detail page: seek to a second, and track the playback time so the
// segment strip and transcript can highlight what is playing.
import { useCallback, useRef, useState, type RefObject } from 'react';
import { clampSeek } from '../core/timeline';

/** What `useVideoSeek` hands the page. */
export interface VideoSeek {
  /** Attach to the `<video>`. */
  ref: RefObject<HTMLVideoElement | null>;
  /** Playback time in seconds, updated on `timeupdate` and on every seek. */
  currentTime: number;
  /** Jumps to `seconds` (clamped to the media) and starts playing. */
  seek: (seconds: number) => void;
  /** Attach to the `<video>` `onTimeUpdate`. */
  onTimeUpdate: () => void;
}

/**
 * Seek and time tracking for one video element.
 * @returns See `VideoSeek`.
 */
export function useVideoSeek(): VideoSeek {
  const ref = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const seek = useCallback((seconds: number) => {
    const video = ref.current;
    if (video === null) return;
    video.currentTime = clampSeek(seconds, video.duration);
    setCurrentTime(video.currentTime);
    video.play().catch(() => {
      // Recovers: autoplay can be refused; the paused frame still shows the moment.
    });
  }, []);

  const onTimeUpdate = useCallback(() => {
    if (ref.current !== null) setCurrentTime(ref.current.currentTime);
  }, []);

  return { ref, currentTime, seek, onTimeUpdate };
}
