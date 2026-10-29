// iRead's voice: says one answer, or reads a letter in turn ("Read it to me": the summary first,
// then the whole letter). Everything is said through `useReadAloudText`, so it is the device's own
// voice, with the server's WAV only as the fallback, and iRead and an iGuide never talk over each
// other. With the device voice, the whole letter is the stored `text`, queued sentence by
// sentence. Without it (or when it fails part way), the letter is read part by part from
// `POST /documents/{id}/speak`, each part fetched only when it is next, and its text is still said
// in the device voice when one is there. Pause holds the voice where it is; Stop ends it. Nothing
// to say it with shows "Voice not available right now".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IREAD_COPY } from '../core/iread/documents';
import { FROM_PART_ZERO, nextRead, type ReadItem } from '../core/iread/read-aloud';
import type { DocumentDetail } from '../services/api/types';
import { useReadAloudText, type SayEnd } from './useReadAloudText';
import { useServices } from './services-context';

/** Where the voice is. */
export type ReadStatus = 'idle' | 'loading' | 'playing' | 'paused';

/** What the player shows. */
export interface ReadState {
  status: ReadStatus;
  /** What plays in a letter read; null for a single answer or when idle. */
  item: ReadItem | null;
  /** How many server parts the letter has, once known. */
  parts: number | null;
  /** "Voice not available right now" or why a part failed; null when fine. */
  message: string | null;
}

/** What a letter read needs; `summary` and `text` may be "" when not known here. */
export type LetterToRead = Pick<DocumentDetail, 'id' | 'summary' | 'text' | 'summary_audio_url'>;

/** The player. */
export interface ReadAloud extends ReadState {
  /** True when the device voice speaks (any text can be read, WAV or not). */
  canSpeak: boolean;
  /** Says one answer from the start; `url` is its WAV fallback. Nothing to say it with shows the no-voice line. */
  playAnswer: (text: string, url: string | null) => void;
  /** Reads a letter from `start`: the summary, then the whole letter. Call it from the tap. */
  readDocument: (doc: LetterToRead, start: ReadItem) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /**
   * Unlocks speech and playback inside a tap (iOS refuses both outside one), for an answer that
   * arrives later (after hold to ask). Call it from the gesture's handler.
   */
  prime: () => void;
  /** How far the WAV is, seconds; null when the device voice speaks or nothing plays. */
  position: () => { atS: number; lengthS: number } | null;
}

const IDLE: ReadState = { status: 'idle', item: null, parts: null, message: null };

const errorLine = (error: unknown): string => (error instanceof Error && error.message !== '' ? error.message : 'Could not read the letter out loud');

/**
 * The read-aloud player; leaving the page stops it.
 * @returns See `ReadAloud`.
 */
export function useReadAloud(): ReadAloud {
  const { api } = useServices();
  const voice = useReadAloudText();
  const { say, canSpeak } = voice;
  const [state, setState] = useState<ReadState>(IDLE);
  // Each start takes a new run; an end or an answer from an older run is ignored.
  const runRef = useRef(0);

  const nextRun = useCallback(() => {
    runRef.current += 1;
    return runRef.current;
  }, []);

  const { stop: stopVoice, prime, pause: pauseVoice, resume: resumeVoice, position } = voice;

  const stop = useCallback(() => {
    nextRun();
    stopVoice();
    setState(IDLE);
  }, [nextRun, stopVoice]);

  const playAnswer = useCallback(
    (text: string, url: string | null) => {
      const run = nextRun();
      const started = say(text, url, (how) => {
        if (runRef.current !== run) return;
        setState(how === 'failed' ? { ...IDLE, message: IREAD_COPY.noVoice } : IDLE);
      });
      setState(started ? { ...IDLE, status: 'playing' } : { ...IDLE, message: IREAD_COPY.noVoice });
    },
    [nextRun, say],
  );

  const readDocument = useCallback(
    (doc: LetterToRead, start: ReadItem) => {
      const run = nextRun();
      const isLive = () => runRef.current === run;
      const hasText = doc.text.trim() !== '';
      // `serverParts` is set once the device voice failed: the rest comes from /speak.
      let serverParts = false;
      const step = (item: ReadItem | null, parts: number | null) => {
        if (!isLive()) return;
        if (item === null) {
          setState(IDLE);
          return;
        }
        const after = (how: SayEnd, next: () => void) => {
          if (!isLive()) return;
          if (how === 'stopped') setState(IDLE);
          else next();
        };
        if (item.kind === 'summary') {
          const started = say(doc.summary, doc.summary_audio_url, (how) => {
            after(how, () => {
              step(nextRead(item, parts), parts);
            });
          });
          if (started) setState({ status: 'playing', item, parts, message: null });
          else step(nextRead(item, parts), parts);
          return;
        }
        if (canSpeak && hasText && !serverParts && item.part === 0) {
          setState({ status: 'playing', item, parts, message: null });
          say(doc.text, null, (how) => {
            after(how, () => {
              if (how === 'ended') {
                setState(IDLE);
                return;
              }
              serverParts = true;
              step(FROM_PART_ZERO, null);
            });
          });
          return;
        }
        setState({ status: 'loading', item, parts, message: null });
        api.speakDocument(doc.id, item.part).then(
          (spoken) => {
            if (!isLive()) return;
            const started = say(spoken.text, spoken.audio_url, (how) => {
              after(how, () => {
                if (how === 'failed') setState({ ...IDLE, parts: spoken.parts, message: IREAD_COPY.noVoice });
                else step(nextRead(item, spoken.parts), spoken.parts);
              });
            });
            setState(started ? { status: 'playing', item, parts: spoken.parts, message: null } : { ...IDLE, parts: spoken.parts, message: IREAD_COPY.noVoice });
          },
          (error: unknown) => {
            if (!isLive()) return;
            setState({ ...IDLE, message: errorLine(error) });
          },
        );
      };
      // What starts first is said at once (inside the tap) unless it must be fetched: unlock now.
      const isAtOnce = start.kind === 'summary' ? (canSpeak && doc.summary.trim() !== '') || doc.summary_audio_url !== null : canSpeak && hasText;
      if (!isAtOnce) prime();
      step(start, null);
    },
    [api, canSpeak, nextRun, prime, say],
  );

  const pause = useCallback(() => {
    pauseVoice();
    setState((current) => (current.status === 'playing' ? { ...current, status: 'paused' } : current));
  }, [pauseVoice]);

  const resume = useCallback(() => {
    resumeVoice();
    setState((current) => (current.status === 'paused' ? { ...current, status: 'playing' } : current));
  }, [resumeVoice]);

  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );

  return useMemo(
    () => ({ ...state, canSpeak, playAnswer, readDocument, pause, resume, stop, prime, position }),
    [state, canSpeak, playAnswer, readDocument, pause, resume, stop, prime, position],
  );
}
