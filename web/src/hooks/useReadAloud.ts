// iRead's voice: plays one answer, or reads a letter in turn (the summary first for "Read it to me",
// then each part of the full text, fetched only when it is next). Pause holds the voice where it
// is; Stop ends it. Everything goes through the one step-audio element, so iRead and an iGuide
// never talk over each other. A null voice URL shows "Voice not available right now" instead.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IREAD_COPY } from '../core/iread/documents';
import { nextRead, type ReadItem } from '../core/iread/read-aloud';
import { SILENT_WAV_URL } from '../services/media/wav-url';
import { useServices } from './services-context';

/** Where the voice is. */
export type ReadStatus = 'idle' | 'loading' | 'playing' | 'paused';

/** What the player shows. */
export interface ReadState {
  status: ReadStatus;
  /** What plays in a letter read; null for a single answer or when idle. */
  item: ReadItem | null;
  /** How many parts the letter has, once known. */
  parts: number | null;
  /** "Voice not available right now" or why a part failed; null when fine. */
  message: string | null;
}

/** The player. */
export interface ReadAloud extends ReadState {
  /** Plays one sound (an answer) from the start; null shows the no-voice line. */
  playUrl: (url: string | null) => void;
  /** Reads a letter from `start`: the summary (`summaryUrl`), then parts 0, 1, … */
  readDocument: (documentId: string, start: ReadItem, summaryUrl: string | null) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /**
   * Unlocks playback inside a tap (iOS refuses play() outside one), for a sound that arrives later
   * (an answer after hold to ask). Call it from the gesture's handler.
   */
  prime: () => void;
  /** How far the sound is, seconds; null when nothing plays. */
  position: () => { atS: number; lengthS: number } | null;
}

const IDLE: ReadState = { status: 'idle', item: null, parts: null, message: null };

/**
 * The read-aloud player; leaving the page stops it.
 * @returns See `ReadAloud`.
 */
export function useReadAloud(): ReadAloud {
  const { api, stepAudio } = useServices();
  const [state, setState] = useState<ReadState>(IDLE);
  // Each start takes a new run; an end or an answer from an older run is ignored.
  const runRef = useRef(0);

  const nextRun = useCallback(() => {
    runRef.current += 1;
    return runRef.current;
  }, []);

  const stop = useCallback(() => {
    nextRun();
    stepAudio.stop();
    setState(IDLE);
  }, [nextRun, stepAudio]);

  const prime = useCallback(() => {
    stepAudio.play(SILENT_WAV_URL, () => undefined);
  }, [stepAudio]);

  const playUrl = useCallback(
    (url: string | null) => {
      const run = nextRun();
      if (url === null) {
        stepAudio.stop();
        setState({ ...IDLE, message: IREAD_COPY.noVoice });
        return;
      }
      setState({ ...IDLE, status: 'playing' });
      stepAudio.play(url, () => {
        if (runRef.current === run) setState(IDLE);
      });
    },
    [nextRun, stepAudio],
  );

  const readDocument = useCallback(
    (documentId: string, start: ReadItem, summaryUrl: string | null) => {
      const run = nextRun();
      const isLive = () => runRef.current === run;
      const step = (item: ReadItem | null, parts: number | null) => {
        if (!isLive()) return;
        if (item === null) {
          setState(IDLE);
          return;
        }
        if (item.kind === 'summary') {
          if (summaryUrl === null) {
            step(nextRead(item, parts), parts);
            return;
          }
          setState({ status: 'playing', item, parts, message: null });
          stepAudio.play(summaryUrl, () => {
            step(nextRead(item, parts), parts);
          });
          return;
        }
        setState({ status: 'loading', item, parts, message: null });
        api.speakDocument(documentId, item.part).then(
          (spoken) => {
            if (!isLive()) return;
            if (spoken.audio_url === null) {
              setState({ ...IDLE, parts: spoken.parts, message: IREAD_COPY.noVoice });
              return;
            }
            setState({ status: 'playing', item, parts: spoken.parts, message: null });
            stepAudio.play(spoken.audio_url, () => {
              step(nextRead(item, spoken.parts), spoken.parts);
            });
          },
          (error: unknown) => {
            if (!isLive()) return;
            setState({ ...IDLE, message: error instanceof Error && error.message !== '' ? error.message : 'Could not read the letter out loud' });
          },
        );
      };
      // A part is fetched before it plays: unlock playback now, inside the tap.
      if (start.kind === 'part' || summaryUrl === null) prime();
      step(start, null);
    },
    [api, nextRun, prime, stepAudio],
  );

  const pause = useCallback(() => {
    stepAudio.pause();
    setState((current) => (current.status === 'playing' ? { ...current, status: 'paused' } : current));
  }, [stepAudio]);

  const resume = useCallback(() => {
    stepAudio.resume();
    setState((current) => (current.status === 'paused' ? { ...current, status: 'playing' } : current));
  }, [stepAudio]);

  useEffect(
    () => () => {
      runRef.current += 1;
      stepAudio.stop();
    },
    [stepAudio],
  );

  return useMemo(
    () => ({ ...state, playUrl, readDocument, pause, resume, stop, prime, position: () => stepAudio.position() }),
    [state, playUrl, readDocument, pause, resume, stop, prime, stepAudio],
  );
}
