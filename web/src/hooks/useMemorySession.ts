// The Memory Lane session player: one moment at a time, its stretch of video with its own sound
// low and its line read aloud in the device voice (the same voice iRead uses). Begin, Next, Back,
// Again and Watch again start the media inside the tap or key press that asked for it (iOS refuses
// speech and playback started outside a user gesture), so the state moves and the media starts in
// the same call. ← / → / space work once the session has begun. Leaving the page ends the voice.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keyAction, MOMENT_VOLUME, momentWindow, SESSION_START, sessionReducer, type SessionAction, type SessionState } from '../core/memory-lane/memories';
import { playMoment, stopMoment } from '../services/media/moment-clip';
import type { MemoryMoment } from '../services/api/types';
import { useReadAloudText } from './useReadAloudText';

/** The player. */
export interface MemorySession {
  state: SessionState;
  /** The moment shown (undefined only for a session with no moments). */
  moment: MemoryMoment | undefined;
  /** False until Begin; the first moment waits for that tap. */
  hasBegun: boolean;
  /** True while the line is read aloud. */
  isReading: boolean;
  /** Starts the first moment (from a tap). */
  begin: () => void;
  /** Moves the session (from a tap or key) and starts what it shows. */
  act: (action: SessionAction) => void;
  /** The <video>'s callback ref; the moments play in it. */
  bindVideo: (element: HTMLVideoElement | null) => void;
}

/**
 * The session over its moments.
 * @param moments - The moments, in order.
 * @returns See `MemorySession`.
 */
export function useMemorySession(moments: readonly MemoryMoment[]): MemorySession {
  const { say, stop: stopVoice, status } = useReadAloudText();
  const reduce = useMemo(() => sessionReducer(moments.length), [moments.length]);
  const [state, setState] = useState<SessionState>(SESSION_START);
  const stateRef = useRef<SessionState>(SESSION_START);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasBegun, setBegun] = useState(false);

  const bindVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
  }, []);

  const start = useCallback(
    (moment: MemoryMoment | undefined) => {
      if (moment === undefined) return;
      const video = videoRef.current;
      if (video !== null && moment.proxy_url !== null) {
        // Set here, not as a prop, so the new source and its start second land in this gesture.
        if (video.getAttribute('src') !== moment.proxy_url) video.setAttribute('src', moment.proxy_url);
        playMoment(video, { ...momentWindow(moment), volume: MOMENT_VOLUME });
      }
      say(moment.line, null);
    },
    [say],
  );

  const quiet = useCallback(() => {
    if (videoRef.current !== null) stopMoment(videoRef.current);
    stopVoice();
  }, [stopVoice]);

  const act = useCallback(
    (action: SessionAction) => {
      const before = stateRef.current;
      const after = reduce(before, action);
      if (after === before) return;
      stateRef.current = after;
      setState(after);
      if (after.isEnded) quiet();
      else if (after.play !== before.play) start(moments[after.at]);
    },
    [moments, quiet, reduce, start],
  );

  const begin = useCallback(() => {
    setBegun(true);
    start(moments[stateRef.current.at]);
  }, [moments, start]);

  useEffect(() => {
    if (!hasBegun) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // Space on a focused button presses that button instead.
      if (event.key === ' ' && target?.tagName === 'BUTTON') return;
      const action = keyAction(event.key);
      if (action === null) return;
      event.preventDefault();
      act(action);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [act, hasBegun]);

  return { state, moment: moments[state.at], hasBegun, isReading: status === 'playing', begin, act, bindVideo };
}
