// The recording player's state (iListen and the Gallery's right column), the clip page's
// `useVideoSeek` pattern for an <audio>: the element's ref and event handlers, whether it plays,
// where it is and how long it is, play/pause and a seek (a tapped line of What was said jumps there
// and plays).
import { useCallback, useRef, useState, type RefObject } from 'react';

/** What `useAudioPlayer` hands the page. */
export interface AudioPlayer {
  /** Attach to the <audio>. */
  ref: RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  /** Where it is, seconds. */
  atS: number;
  /** How long it is, seconds: the file's once known, else the recording's own. */
  lengthS: number;
  toggle: () => void;
  /** Jumps to `seconds` and plays from there. */
  seek: (seconds: number) => void;
  /** The <audio>'s handlers: `onTimeUpdate`, `onLoadedMetadata`, `onPlay`, `onPause`, `onEnded`. */
  events: {
    onTimeUpdate: () => void;
    onLoadedMetadata: () => void;
    onPlay: () => void;
    onPause: () => void;
    onEnded: () => void;
  };
}

/**
 * The player state for one <audio>.
 * @param fallbackLengthS - The length to show before the file says (the recording's own length).
 * @returns See `AudioPlayer`.
 */
export function useAudioPlayer(fallbackLengthS: number): AudioPlayer {
  const ref = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [atS, setAt] = useState(0);
  const [fileLengthS, setFileLength] = useState(0);

  const play = useCallback((audio: HTMLAudioElement) => {
    audio.play().catch(() => {
      // Recovers: the browser refused to play (no tap yet, or the file failed); the button stays on Play.
      setPlaying(false);
    });
  }, []);

  const toggle = useCallback(() => {
    const audio = ref.current;
    if (audio === null) return;
    if (audio.paused) play(audio);
    else audio.pause();
  }, [play]);

  const seek = useCallback(
    (seconds: number) => {
      const audio = ref.current;
      if (audio === null) return;
      audio.currentTime = Math.max(0, seconds);
      setAt(audio.currentTime);
      play(audio);
    },
    [play],
  );

  const onTimeUpdate = useCallback(() => {
    if (ref.current !== null) setAt(ref.current.currentTime);
  }, []);
  const onLoadedMetadata = useCallback(() => {
    const length = ref.current?.duration ?? Number.NaN;
    if (Number.isFinite(length)) setFileLength(length);
  }, []);
  const onPlay = useCallback(() => {
    setPlaying(true);
  }, []);
  const onPause = useCallback(() => {
    setPlaying(false);
  }, []);

  return {
    ref,
    isPlaying,
    atS,
    lengthS: fileLengthS > 0 ? fileLengthS : fallbackLengthS,
    toggle,
    seek,
    events: { onTimeUpdate, onLoadedMetadata, onPlay, onPause, onEnded: onPause },
  };
}
