// Hold to talk for the Ask box: `press` (pointer down) opens the microphone and records, `release`
// (pointer up) stops, sends the note to Muse Voice Transcribe and hands the text to `onText`. A
// note stops by itself at 60 s. Every problem becomes a message the box shows until the next press.
import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeProblem, VOICE_MAX_MS, VOICE_MIN_MS, voiceMessage, type VoiceProblem } from '../core/ask/voice';
import { ApiError } from '../services/api/client';
import { VoiceError, type VoiceRecording } from '../services/media/voice-recorder';
import { useServices } from './services-context';

/** Where hold to talk is. */
export type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing';

/** Hold to talk's state and controls. */
export interface VoiceNote {
  phase: VoicePhase;
  /** When recording started, ms (`Date.now()`); null when not recording. */
  startedAt: number | null;
  /** What went wrong last; null when nothing did. */
  message: string | null;
  /** Starts a note (pointer down). */
  press: () => void;
  /** Ends the note and transcribes it (pointer up). */
  release: () => void;
}

/** What one press is up to; a new press replaces it, so a late answer of an old one is dropped. */
interface Take {
  recording: VoiceRecording | null;
  isReleased: boolean;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Hold to talk.
 * @param onText - Gets what was said (never empty).
 * @returns The state and `press` / `release`.
 */
export function useVoiceNote(onText: (text: string) => void): VoiceNote {
  const { voice, api } = useServices();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const takeRef = useRef<Take | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const fail = useCallback((take: Take, problem: VoiceProblem) => {
    if (takeRef.current !== take) return;
    takeRef.current = null;
    setPhase('idle');
    setStartedAt(null);
    setMessage(voiceMessage(problem));
  }, []);

  const finish = useCallback(
    async (take: Take) => {
      const { recording } = take;
      if (recording === null) return;
      // Once only: the 60 s stop and the pointer up may both arrive.
      take.recording = null;
      if (take.timer !== null) clearTimeout(take.timer);
      setStartedAt(null);
      if (Date.now() - take.startedAt < VOICE_MIN_MS) {
        recording.cancel();
        fail(take, 'TOO_SHORT');
        return;
      }
      setPhase('transcribing');
      try {
        const audio = await recording.stop();
        const { text } = await api.transcribe(audio);
        if (takeRef.current !== take) return;
        const clean = text.trim();
        if (clean === '') {
          fail(take, 'NOTHING_HEARD');
          return;
        }
        takeRef.current = null;
        setPhase('idle');
        onTextRef.current(clean);
      } catch (error) {
        fail(take, transcribeProblem(error instanceof ApiError ? error.code : null));
      }
    },
    [api, fail],
  );

  const press = useCallback(() => {
    if (takeRef.current !== null) return;
    const take: Take = { recording: null, isReleased: false, startedAt: Date.now(), timer: null };
    takeRef.current = take;
    setMessage(null);
    setPhase('starting');
    voice.start().then(
      (recording) => {
        if (takeRef.current !== take) {
          recording.cancel();
          return;
        }
        take.recording = recording;
        take.startedAt = Date.now();
        if (take.isReleased) {
          // Let go before the microphone opened: a slip.
          void finish(take);
          return;
        }
        take.timer = setTimeout(() => void finish(take), VOICE_MAX_MS);
        setPhase('recording');
        setStartedAt(take.startedAt);
      },
      (error: unknown) => {
        fail(take, error instanceof VoiceError ? error.code : 'MIC_FAILED');
      },
    );
  }, [voice, fail, finish]);

  const release = useCallback(() => {
    const take = takeRef.current;
    if (take === null || take.isReleased) return;
    take.isReleased = true;
    if (take.recording !== null) void finish(take);
  }, [finish]);

  useEffect(
    () => () => {
      const take = takeRef.current;
      takeRef.current = null;
      if (take?.timer != null) clearTimeout(take.timer);
      take?.recording?.cancel();
    },
    [],
  );

  return { phase, startedAt, message, press, release };
}
