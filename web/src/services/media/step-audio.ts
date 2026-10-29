// Plays a guide step's spoken instruction (the voice half of ▶ Play). One <audio> element, made on
// first use and reused, so iOS keeps it unlocked after the first tap. An <audio> element plays with
// the phone's silent switch on, where Web Audio would not. `play` calls `element.play()` at once, so
// it must run inside the tap handler (iOS refuses playback started outside a user gesture).

/** Plays one step's audio at a time. */
export interface StepAudio {
  /**
   * Stops what plays and plays `url` from the start.
   * @param url - The step's WAV.
   * @param onEnd - Called once when it ends, is stopped or the browser refuses to play it.
   */
  play: (url: string, onEnd: () => void) => void;
  /** Stops playback; the pending `onEnd` runs. */
  stop: () => void;
}

/** The parts of an audio element the player uses; tests pass a fake. */
export interface AudioTarget {
  src: string;
  currentTime: number;
  onended: ((event: Event) => unknown) | null;
  play: () => Promise<void>;
  pause: () => void;
}

/**
 * Builds the player.
 * @param makeAudio - Makes the element (`() => new Audio()` in the app).
 * @returns The player.
 */
export function createStepAudio(makeAudio: () => AudioTarget): StepAudio {
  let element: AudioTarget | null = null;
  let finish: (() => void) | null = null;

  const end = () => {
    const done = finish;
    finish = null;
    done?.();
  };

  const stop = () => {
    if (element !== null) {
      element.pause();
      element.onended = null;
    }
    end();
  };

  return {
    play: (url, onEnd) => {
      stop();
      element ??= makeAudio();
      const audio = element;
      finish = onEnd;
      audio.onended = end;
      audio.src = url;
      audio.currentTime = 0;
      audio.play().catch(() => {
        // Recovers: playback was refused or the file failed; Play counts the voice as ended.
        if (finish === onEnd) end();
      });
    },
    stop,
  };
}
