// The Ask box's hold-to-talk words: what the box says while it listens, and what it says when a
// voice note did not work.
import { ERROR } from '../../services/api/types';

/** Longest note the server reads, ms (it transcribes the first 60 s). */
export const VOICE_MAX_MS = 60_000;

/** A shorter hold is a slip, not a note, ms. */
export const VOICE_MIN_MS = 300;

/** The line while it listens. */
export const LISTENING_LINE = 'Listening… speak your request';

/** The line while Muse Voice Transcribe works. */
export const TRANSCRIBING_LINE = 'Transcribing with Muse Voice Transcribe…';

/** Why a voice note did not become text. */
export type VoiceProblem = 'MIC_DENIED' | 'MIC_MISSING' | 'MIC_FAILED' | 'TOO_SHORT' | 'NOTHING_HEARD' | 'UNREADABLE' | 'TRANSCRIBE_FAILED';

const MESSAGE: Record<VoiceProblem, string> = {
  MIC_DENIED: 'Microphone not allowed. Turn it on for nimbytes in System Settings › Privacy',
  MIC_MISSING: 'No microphone found',
  MIC_FAILED: 'Could not start the microphone',
  TOO_SHORT: 'Hold the mic while you speak',
  NOTHING_HEARD: 'Nothing heard. Hold the mic and speak',
  UNREADABLE: "Couldn't hear that, try again",
  TRANSCRIBE_FAILED: 'Transcribe did not answer. Try again or type',
};

/**
 * What the box says for a problem.
 * @param problem - Why.
 * @returns The message.
 */
export const voiceMessage = (problem: VoiceProblem): string => MESSAGE[problem];

/**
 * The problem a refused transcribe means: the server could not read the audio (400
 * `VALIDATION_FAILED`, including audio ffmpeg cannot decode), or anything else.
 * @param code - The error code, or null when the call failed without one.
 * @returns The problem.
 */
export const transcribeProblem = (code: string | null): VoiceProblem => (code === ERROR.VALIDATION_FAILED ? 'UNREADABLE' : 'TRANSCRIBE_FAILED');

/**
 * Bar heights of the listening wave, px: a fixed ripple, so the box does not jump.
 * @param count - Bars.
 * @param min - Shortest bar.
 * @param span - How much taller the tallest bar is.
 * @returns The heights.
 */
export function waveHeights(count: number, min: number, span: number): number[] {
  return Array.from({ length: count }, (_, i) => min + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * span));
}
