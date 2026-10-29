// Port: speaks text in the device's own voice (owner ruling 2026-10-29: the natural Mac and iPhone
// voices read aloud; the server's WAV is only the fallback). One speaker for the whole app, so a
// new `speak` ends what spoke before.

/** What `speak` reports. */
export interface SpeakHandlers {
  /** Called once when the whole text was spoken, or when `stop` (or a newer `speak`) ended it. */
  onEnd: () => void;
  /** Called once, instead of `onEnd`, when the device failed to speak it. */
  onError: () => void;
}

/** The device voice. */
export interface Speaker {
  /** True when the device can speak and has a usable voice. */
  isAvailable(): boolean;
  /**
   * Ends what speaks, then speaks `text` from the start. On iOS call it inside the tap handler.
   * @param text - Any length; it is spoken sentence by sentence.
   * @param handlers - See `SpeakHandlers`.
   */
  speak(text: string, handlers: SpeakHandlers): void;
  /** Holds the voice where it is. No-op when nothing speaks. */
  pause(): void;
  /** Goes on from where `pause` held it. No-op when nothing is held. */
  resume(): void;
  /** Ends what speaks; its pending `onEnd` runs. */
  stop(): void;
  /** Unlocks speech inside a tap for text that arrives later (iOS refuses speech outside one). */
  unlock(): void;
}
