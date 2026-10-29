// The device's own voice over the Web Speech API (`window.speechSynthesis`): the natural Mac and
// iPhone voices (owner ruling 2026-10-29; the server's WAV stays only as the fallback). Text is cut
// into sentence-sized utterances and all of them are queued at once, inside the tap on iOS: Safari
// stops one long utterance part way, and a queue makes pause and stop reliable. The voice is picked
// again whenever the device's voice list changes (voices load late in Chrome).
import type { SpeakHandlers, Speaker } from '../../core/ports/speaker';
import { splitUtterances } from '../../core/speech/utterances';
import { pickVoice, SPEECH_RATE, type VoiceInfo } from '../../core/speech/voice-choice';

/** The parts of an utterance the adapter sets; tests pass a fake. */
export interface UtteranceTarget {
  text: string;
  voice: SpeechSynthesisVoice | null;
  lang: string;
  rate: number;
  volume: number;
  onend: ((event: SpeechSynthesisEvent) => unknown) | null;
  onerror: ((event: SpeechSynthesisErrorEvent) => unknown) | null;
}

/** The parts of `speechSynthesis` the adapter uses; tests pass a fake. */
export interface SynthTarget {
  speak(utterance: UtteranceTarget): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): (VoiceInfo & SpeechSynthesisVoice)[];
  addEventListener(type: 'voiceschanged', listener: () => void): void;
}

/** What the adapter is built from. */
export interface DeviceVoiceDeps {
  /** `window.speechSynthesis`, or undefined where the browser has none. */
  synth: SynthTarget | undefined;
  /** `(text) => new SpeechSynthesisUtterance(text)`. */
  makeUtterance: (text: string) => UtteranceTarget;
  /** Told the chosen voice's name once each time it changes (a dev-only debug line). */
  onVoice?: ((name: string) => void) | undefined;
}

/**
 * Builds the device voice.
 * @param deps - See `DeviceVoiceDeps`.
 * @returns The speaker; `isAvailable` is false without speech or an English voice.
 */
export function createDeviceVoice({ synth, makeUtterance, onVoice }: DeviceVoiceDeps): Speaker {
  let voice: SpeechSynthesisVoice | null = null;
  let told = '';
  // The utterances queued now; kept so the browser cannot drop them before they end (iOS).
  let queue: UtteranceTarget[] = [];
  let pending: SpeakHandlers | null = null;

  const choose = () => {
    if (synth === undefined) return;
    voice = pickVoice(synth.getVoices());
    if (voice !== null && voice.name !== told) {
      told = voice.name;
      onVoice?.(voice.name);
    }
  };
  choose();
  synth?.addEventListener('voiceschanged', choose);

  const detach = () => {
    for (const utterance of queue) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    queue = [];
  };

  const settle = (failed: boolean) => {
    const handlers = pending;
    pending = null;
    detach();
    if (failed) handlers?.onError();
    else handlers?.onEnd();
  };

  const stop = () => {
    // Nothing of ours is queued: no cancel(), which can drop a speak() made right after it.
    if (synth === undefined || pending === null) return;
    // Handlers come off first: cancel() fires "interrupted" errors that are not failures.
    detach();
    synth.cancel();
    settle(false);
  };

  return {
    isAvailable: () => {
      if (voice === null) choose();
      return voice !== null;
    },
    speak: (text, handlers) => {
      stop();
      if (synth === undefined) {
        handlers.onError();
        return;
      }
      if (voice === null) choose();
      const lines = splitUtterances(text);
      pending = handlers;
      if (lines.length === 0) {
        settle(false);
        return;
      }
      queue = lines.map((line, index) => {
        const utterance = makeUtterance(line);
        utterance.voice = voice;
        utterance.lang = voice?.lang ?? 'en-GB';
        utterance.rate = SPEECH_RATE;
        utterance.volume = 1;
        if (index === lines.length - 1) {
          utterance.onend = () => {
            settle(false);
          };
        }
        utterance.onerror = (event) => {
          // Recovers: a cancel from outside (another page, the system) only ends it; any other
          // error ends the queue and the caller falls back to the WAV.
          const isCancel = event.error === 'interrupted' || event.error === 'canceled';
          detach();
          if (!isCancel) synth.cancel();
          settle(!isCancel);
        };
        return utterance;
      });
      // Chrome can hold a paused queue across cancel(); resume so the new text is heard.
      synth.resume();
      for (const utterance of queue) synth.speak(utterance);
    },
    pause: () => {
      if (pending !== null) synth?.pause();
    },
    resume: () => {
      if (pending !== null) synth?.resume();
    },
    stop,
    unlock: () => {
      if (synth === undefined || pending !== null) return;
      const silent = makeUtterance(' ');
      silent.volume = 0;
      synth.speak(silent);
    },
  };
}
