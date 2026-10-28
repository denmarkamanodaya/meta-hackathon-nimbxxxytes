// ▶ Hear on a guide step: which step is speaking, and a toggle that starts playback inside the
// tap handler (the service calls `play()` at once, as iOS requires). Leaving the page stops it.
import { useCallback, useEffect, useState } from 'react';
import { useServices } from './services-context';

/** ▶ Hear for the step shown. */
export interface StepAudioControls {
  /** The step number speaking, or null. */
  speaking: number | null;
  /** Plays step `n`'s audio, or stops it when it is the one speaking. Call it from the tap. */
  toggle: (n: number, url: string) => void;
  stop: () => void;
}

/**
 * Step narration playback.
 * @returns See `StepAudioControls`.
 */
export function useStepAudio(): StepAudioControls {
  const { stepAudio } = useServices();
  const [speaking, setSpeaking] = useState<number | null>(null);

  const toggle = useCallback(
    (n: number, url: string) => {
      if (speaking === n) {
        stepAudio.stop();
        return;
      }
      setSpeaking(n);
      stepAudio.play(url, () => {
        setSpeaking((current) => (current === n ? null : current));
      });
    },
    [speaking, stepAudio],
  );

  const stop = useCallback(() => {
    stepAudio.stop();
  }, [stepAudio]);

  useEffect(() => () => {
    stepAudio.stop();
  }, [stepAudio]);

  return { speaking, toggle, stop };
}
