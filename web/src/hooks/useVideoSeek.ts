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
  /** Attach to the `<video>` `onLoadedMetadata`; applies the deep-link start once. */
  onLoadedMetadata: () => void;
}

/**
 * Seek and time tracking for one video element.
 * @param startSeconds - Deep-link start (`?t=`), applied once when metadata loads, without
 *   autoplay; null to start at 0.
 * @returns See `VideoSeek`.
 */
export function useVideoSeek(startSeconds: number | null = null): VideoSeek {
  const ref = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(startSeconds ?? 0);
  const startApplied = useRef(false);

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

  const onLoadedMetadata = useCallback(() => {
    const video = ref.current;
    if (video === null || startSeconds === null || startApplied.current) return;
    startApplied.current = true;
    video.currentTime = clampSeek(startSeconds, video.duration);
    setCurrentTime(video.currentTime);
  }, [startSeconds]);

  return { ref, currentTime, seek, onTimeUpdate, onLoadedMetadata };
}
