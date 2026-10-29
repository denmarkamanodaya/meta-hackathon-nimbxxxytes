// ▶ Play on a guide step: the step's narration ("Step 3. Turn the dial.") in the device's own voice
// (the server's WAV only as the fallback) and its short clip together, the clip once and muted over
// the photo. Both start inside the tap handler (iOS refuses speech and playback started outside a
// user gesture): the voice through `useReadAloudText`, the clip in the <video> the page binds with
// `bindClip`. Playing ends when both parts have ended, on a second tap, or when the page stops it
// (a step change); leaving the page stops it too, and so does another voice starting.
import { useCallback, useEffect, useRef, useState } from 'react';
import { canPlayStep, stepNarration } from '../core/guides';
import { startClip, stopClip } from '../services/media/step-clip';
import type { GuideStep } from '../services/api/types';
import { useReadAloudText } from './useReadAloudText';

/** What Play needs from a step. */
export type PlayableStep = Pick<GuideStep, 'n' | 'instruction' | 'audio_url' | 'clip_url'>;

/** ▶ Play for the step shown. */
export interface StepPlayControls {
  /** The step number playing, or null (the photo shows). */
  playing: number | null;
  /** The step's <video> callback ref; the clip plays in it. */
  bindClip: (element: HTMLVideoElement | null) => void;
  /** Plays the step's voice and clip, or stops both when that step is playing. Call it from the tap. */
  toggle: (step: PlayableStep) => void;
  /** Stops both parts and shows the photo again. */
  stop: () => void;
  /** False when the step has nothing to say or show (Play is off). */
  canPlay: (step: PlayableStep) => boolean;
}

/** One press of Play: the step and how many of its parts are still playing. */
interface Run {
  n: number;
  left: number;
}

/**
 * Step playback: voice and clip as one.
 * @returns See `StepPlayControls`.
 */
export function useStepPlay(): StepPlayControls {
  const { say, stop: stopVoice, canSpeak } = useReadAloudText();
  const clipRef = useRef<HTMLVideoElement | null>(null);
  const run = useRef<Run | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  const bindClip = useCallback((element: HTMLVideoElement | null) => {
    clipRef.current = element;
  }, []);

  const stop = useCallback(() => {
    run.current = null;
    stopVoice();
    if (clipRef.current !== null) stopClip(clipRef.current);
    setPlaying(null);
  }, [stopVoice]);

  const toggle = useCallback(
    (step: PlayableStep) => {
      const isSameStep = run.current?.n === step.n;
      stop();
      if (isSameStep) return;
      const clip = step.clip_url === null ? null : clipRef.current;
      const current: Run = { n: step.n, left: 0 };
      run.current = current;
      const partEnded = () => {
        if (run.current !== current) return;
        current.left -= 1;
        if (current.left > 0) return;
        run.current = null;
        setPlaying(null);
      };
      setPlaying(step.n);
      if (say(stepNarration(step), step.audio_url, partEnded)) current.left += 1;
      if (clip !== null) {
        current.left += 1;
        startClip(clip, partEnded);
      }
      if (current.left === 0) {
        run.current = null;
        setPlaying(null);
      }
    },
    [say, stop],
  );

  useEffect(
    () => () => {
      run.current = null;
    },
    [],
  );

  const canPlay = useCallback((step: PlayableStep) => canPlayStep(step, canSpeak), [canSpeak]);

  return { playing, bindClip, toggle, stop, canPlay };
}
