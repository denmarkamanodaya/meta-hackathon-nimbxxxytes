// Plays a guide step's spoken instruction (the voice half of ▶ Play). One <audio> element, made on
// first use and reused, so iOS keeps it unlocked after the first tap. An <audio> element plays with
// the phone's silent switch on, where Web Audio would not. `play` calls `element.play()` at once, so
// it must run inside the tap handler (iOS refuses playback started outside a user gesture). iRead's
// answers also pause and resume, and show how far they are.

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
  /** Holds what plays where it is; `onEnd` stays pending. No-op when nothing plays. */
  pause: () => void;
  /** Goes on from where `pause` held it. No-op when nothing is held. */
  resume: () => void;
  /** How far the sound is, seconds; null when nothing plays or is held (length 0 until known). */
  position: () => { atS: number; lengthS: number } | null;
}

/** The parts of an audio element the player uses; tests pass a fake. */
export interface AudioTarget {
  src: string;
  currentTime: number;
  /** NaN until the file's length is known. */
  readonly duration: number;
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

  const resumeElement = (audio: AudioTarget) => {
    const onEnd = finish;
    audio.play().catch(() => {
      // Recovers: the browser refused to go on; the voice counts as ended.
      if (finish === onEnd) end();
    });
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
    pause: () => {
      if (element !== null && finish !== null) element.pause();
    },
    resume: () => {
      if (element !== null && finish !== null) resumeElement(element);
    },
    position: () => {
      if (element === null || finish === null) return null;
      const length = Number.isFinite(element.duration) ? element.duration : 0;
      return { atS: element.currentTime, lengthS: length };
    },
  };
}
