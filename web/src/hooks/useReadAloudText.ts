// Every place that reads text aloud goes through this hook (owner ruling 2026-10-29): it speaks the
// text in the device's own voice, and plays the server's WAV only when the device has no usable
// voice or fails to speak. One voice at a time across the app: starting one ends whatever another
// hook was saying, and that hook hears "stopped". Start it inside the tap handler (iOS refuses
// speech and playback started outside a user gesture); `prime` unlocks both for text that arrives
// later.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Speaker } from '../core/ports/speaker';
import { SILENT_WAV_URL } from '../services/media/wav-url';
import { useServices } from './services-context';

/** Where the voice is. */
export type SayStatus = 'idle' | 'playing' | 'paused';

/** How a `say` ended: spoken to the end, ended by another voice, or no voice could say it. */
export type SayEnd = 'ended' | 'stopped' | 'failed';

/** The voice. */
export interface ReadAloudText {
  status: SayStatus;
  /** True when the device voice can speak (the WAV is then only the fallback). */
  canSpeak: boolean;
  /** True when the device has a voice for `language` (ISO 639-1). */
  canSpeakIn: (language: string) => boolean;
  /**
   * Ends what any voice says, then says `text`: in the device voice, else `fallbackUrl`'s WAV.
   * @param onEnd - Called once when it ends on its own or another voice ends it; never after this
   *   hook's own `stop` or next `say`.
   * @param language - ISO 639-1 of the text (an iListen summary); English when left out.
   * @returns False when nothing can say it (no device voice and no WAV); nothing starts.
   */
  say: (text: string, fallbackUrl: string | null, onEnd?: (how: SayEnd) => void, language?: string) => boolean;
  pause: () => void;
  resume: () => void;
  /** Ends what this hook says; another hook's voice goes on. */
  stop: () => void;
  /** Unlocks speech and playback inside a tap, for a `say` that comes later; ends any voice. */
  prime: () => void;
  /** How far the WAV is, seconds; null when the device voice speaks (it has no clock) or idle. */
  position: () => { atS: number; lengthS: number } | null;
}

/** Who holds the one voice: a ticket per `say`, shared by every hook on the same speaker. */
const seats = new WeakMap<Speaker, { ticket: number }>();

const seatOf = (speaker: Speaker): { ticket: number } => {
  let seat = seats.get(speaker);
  if (seat === undefined) {
    seat = { ticket: 0 };
    seats.set(speaker, seat);
  }
  return seat;
};

/**
 * The read-aloud voice; leaving the page ends what it says.
 * @returns See `ReadAloudText`.
 */
export function useReadAloudText(): ReadAloudText {
  const { speaker, stepAudio } = useServices();
  const [status, setStatus] = useState<SayStatus>('idle');
  // This hook's live ticket (0 when it says nothing) and what is saying it.
  const mine = useRef(0);
  const via = useRef<'device' | 'wav' | null>(null);

  const isOwner = useCallback(() => mine.current !== 0 && seatOf(speaker).ticket === mine.current, [speaker]);

  const quiet = useCallback(() => {
    mine.current = 0;
    via.current = null;
    speaker.stop();
    stepAudio.stop();
  }, [speaker, stepAudio]);

  const stop = useCallback(() => {
    if (isOwner()) {
      seatOf(speaker).ticket += 1;
      quiet();
    }
    mine.current = 0;
    setStatus('idle');
  }, [isOwner, quiet, speaker]);

  const say = useCallback(
    (text: string, fallbackUrl: string | null, onEnd?: (how: SayEnd) => void, language?: string): boolean => {
      const seat = seatOf(speaker);
      seat.ticket += 1;
      const ticket = seat.ticket;
      // Older voices end now; their hooks see the seat moved on and hear "stopped".
      quiet();
      mine.current = ticket;
      const settle = (how: SayEnd) => {
        if (mine.current !== ticket) return;
        mine.current = 0;
        via.current = null;
        setStatus('idle');
        onEnd?.(how);
      };
      const finished = () => {
        settle(seat.ticket === ticket ? 'ended' : 'stopped');
      };
      const playWav = (url: string) => {
        via.current = 'wav';
        stepAudio.play(url, finished);
      };
      if (text.trim() !== '' && speaker.isAvailable(language)) {
        via.current = 'device';
        setStatus('playing');
        speaker.speak(
          text,
          {
            onEnd: finished,
            onError: () => {
              // Recovers: the device could not speak it; the server's WAV says it instead.
              if (mine.current !== ticket || seat.ticket !== ticket) finished();
              else if (fallbackUrl !== null) playWav(fallbackUrl);
              else settle('failed');
            },
          },
          language,
        );
        return true;
      }
      if (fallbackUrl !== null) {
        setStatus('playing');
        playWav(fallbackUrl);
        return true;
      }
      mine.current = 0;
      setStatus('idle');
      return false;
    },
    [quiet, speaker, stepAudio],
  );

  const pause = useCallback(() => {
    if (!isOwner()) return;
    if (via.current === 'device') speaker.pause();
    else stepAudio.pause();
    setStatus((current) => (current === 'playing' ? 'paused' : current));
  }, [isOwner, speaker, stepAudio]);

  const resume = useCallback(() => {
    if (!isOwner()) return;
    if (via.current === 'device') speaker.resume();
    else stepAudio.resume();
    setStatus((current) => (current === 'paused' ? 'playing' : current));
  }, [isOwner, speaker, stepAudio]);

  const prime = useCallback(() => {
    seatOf(speaker).ticket += 1;
    quiet();
    setStatus('idle');
    speaker.unlock();
    stepAudio.play(SILENT_WAV_URL, () => undefined);
  }, [quiet, speaker, stepAudio]);

  const position = useCallback(() => (isOwner() && via.current === 'wav' ? stepAudio.position() : null), [isOwner, stepAudio]);

  useEffect(
    () => () => {
      if (isOwner()) {
        seatOf(speaker).ticket += 1;
        quiet();
      }
      mine.current = 0;
    },
    [isOwner, quiet, speaker],
  );

  const canSpeak = speaker.isAvailable();
  const canSpeakIn = useCallback((language: string) => speaker.isAvailable(language), [speaker]);
  return useMemo(
    () => ({ status, canSpeak, canSpeakIn, say, pause, resume, stop, prime, position }),
    [status, canSpeak, canSpeakIn, say, pause, resume, stop, prime, position],
  );
}
