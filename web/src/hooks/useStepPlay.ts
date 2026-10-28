// ▶ Play on a guide step: the step's voice and its short clip together, the clip once and muted
// over the photo. Both start inside the tap handler (iOS refuses playback started outside a user
// gesture): the voice through the step-audio service, the clip in the <video> the page binds with
// `bindClip`. Playing ends when both parts have ended, on a second tap, or when the page stops it
// (a step change); leaving the page stops it too.
import { useCallback, useEffect, useRef, useState } from 'react';
import { startClip, stopClip } from '../services/media/step-clip';
import type { GuideStep } from '../services/api/types';
import { useServices } from './services-context';

/** What Play needs from a step. */
export type PlayableStep = Pick<GuideStep, 'n' | 'audio_url' | 'clip_url'>;

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
  const { stepAudio } = useServices();
  const clipRef = useRef<HTMLVideoElement | null>(null);
  const run = useRef<Run | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  const bindClip = useCallback((element: HTMLVideoElement | null) => {
    clipRef.current = element;
  }, []);

  const stop = useCallback(() => {
    // Cleared first, so the voice's onEnd that `stepAudio.stop()` fires finds no run to count.
    run.current = null;
    stepAudio.stop();
    if (clipRef.current !== null) stopClip(clipRef.current);
    setPlaying(null);
  }, [stepAudio]);

  const toggle = useCallback(
    (step: PlayableStep) => {
      const isSameStep = run.current?.n === step.n;
      stop();
      if (isSameStep) return;
      const clip = step.clip_url === null ? null : clipRef.current;
      const current: Run = { n: step.n, left: (step.audio_url === null ? 0 : 1) + (clip === null ? 0 : 1) };
      if (current.left === 0) return;
      run.current = current;
      const partEnded = () => {
        if (run.current !== current) return;
        current.left -= 1;
        if (current.left > 0) return;
        run.current = null;
        setPlaying(null);
      };
      setPlaying(step.n);
      if (step.audio_url !== null) stepAudio.play(step.audio_url, partEnded);
      if (clip !== null) startClip(clip, partEnded);
    },
    [stepAudio, stop],
  );

  useEffect(() => () => {
    run.current = null;
    stepAudio.stop();
  }, [stepAudio]);

  return { playing, bindClip, toggle, stop };
}
