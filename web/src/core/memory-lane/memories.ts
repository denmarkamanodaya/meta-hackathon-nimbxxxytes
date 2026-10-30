// Memory Lane rules the pages share (phase 32, the approved mock): the words, the making screen's
// progress rows and agent-check note, the session player's state (which moment, whether the names
// show, the end screen) and the moment's playing window.
import type { MemoryDetail, MemoryMoment, MemoryStatus, MemoryStep, MemorySummary } from '../../services/api/types';
import { MEMORY_STEPS } from '../../services/api/types';
import type { StageState } from '../guides';

/** User-facing words for Memory Lane. */
export const MEMORY_COPY = {
  section: 'Memory Lane',
  startTitle: 'Who shall we remember today?',
  startBody: 'Pick a person or a day. nimbytes finds the moments and tells the story aloud.',
  forViewer: 'For',
  nobody: 'Anyone',
  aDay: 'A day',
  pickDay: 'Pick the day',
  start: 'Start',
  starting: 'Starting…',
  startFailed: 'Could not start the session',
  noPeople: 'Name people under Faces first, or pick a day.',
  pastSessions: 'Past sessions',
  emptyPast: 'No sessions yet.',
  makingBody: 'Four Meta AI steps, each checked before the next.',
  failedTitle: 'This session could not be made',
  failedBody: 'Try again with another person or day.',
  whoIsThis: 'Who is this?',
  again: 'Again',
  next: 'Next',
  back: 'Back',
  finish: 'Finish',
  end: 'End',
  readingAloud: 'Reading aloud',
  checkedBadge: 'Checked by the agent',
  watchAgain: 'Watch again',
  allSessions: 'All sessions',
  noMoments: 'No moments were found for this session.',
} as const;

/** The moment's own sound under the voice (0–1). */
export const MOMENT_VOLUME = 0.3;

/** Lowest a moment plays, seconds, so a zero-length window still shows something. */
const MIN_WINDOW_S = 1;

const STAGE: Record<MemoryStep, { label: string; model: string }> = {
  find: { label: 'Find the moments', model: 'SAM 3.1 faces · Perception Encoder' },
  write: { label: 'Write the session', model: 'Muse Spark sees faces and frames' },
  check: { label: 'Check every line', model: 'Muse Spark' },
  cover: { label: 'Paint the cover', model: 'Muse Image' },
};

/** One making-screen row. */
export interface MemoryStageRow {
  id: MemoryStep;
  label: string;
  /** The model or tool doing it. */
  model: string;
  state: StageState;
}

/** What each step does, as the Ask box's plan card says it. */
export const MEMORY_ROW_DETAIL: Record<MemoryStep, string> = {
  find: 'The best moments, by who is in them',
  write: 'One line and one gentle question per moment',
  check: 'Every line against its frame; a wrong one is fixed',
  cover: 'A cover from the first moments',
};

/**
 * Whether the job still runs.
 * @param status - The session's status.
 * @returns True while making.
 */
export const isMemoryBusy = (status: MemoryStatus): boolean => status === 'making';

/**
 * The making screen's progress rows: steps before the running one are done.
 * @param summary - The session.
 * @returns One row per step.
 */
export function memoryStageRows(summary: Pick<MemorySummary, 'status' | 'step'>): MemoryStageRow[] {
  const at = summary.status === 'making' ? (summary.step === null ? 0 : MEMORY_STEPS.indexOf(summary.step)) : MEMORY_STEPS.length;
  return MEMORY_STEPS.map((step, index) => ({ id: step, ...STAGE[step], state: index < at ? 'done' : index === at ? 'now' : 'next' }));
}

const possessive = (name: string): string => (name.endsWith('s') ? `${name}’` : `${name}’s`);

/**
 * The making screen's title ("Making Kristoff’s memory session").
 * @param summary - The session.
 * @returns The title.
 */
export const makingTitle = (summary: Pick<MemorySummary, 'subject_kind' | 'subject_name'>): string =>
  summary.subject_kind === 'person' ? `Making ${possessive(summary.subject_name)} memory session` : `Making a memory session of ${summary.subject_name}`;

/**
 * A session's name in lists: its written title, else who or what it is about.
 * @param summary - The session.
 * @returns The name.
 */
export const memoryTitle = (summary: Pick<MemorySummary, 'title' | 'subject_name'>): string => (summary.title.trim() === '' ? summary.subject_name : summary.title);

/**
 * The list row's second line ("For Eric · 6 moments").
 * @param summary - The session.
 * @returns The line.
 */
export function memoryFacts(summary: Pick<MemorySummary, 'viewer_name' | 'moment_count' | 'status'>): string {
  const parts = summary.viewer_name === null ? [] : [`${MEMORY_COPY.forViewer} ${summary.viewer_name}`];
  if (summary.status === 'ready') parts.push(momentCount(summary.moment_count));
  if (summary.status === 'making') parts.push('Making…');
  if (summary.status === 'failed') parts.push('Stopped');
  return parts.join(' · ');
}

/**
 * "1 moment", "6 moments".
 * @param count - How many.
 * @returns The words.
 */
export const momentCount = (count: number): string => `${String(count)} ${count === 1 ? 'moment' : 'moments'}`;

/**
 * The agent-check note, once the check ran ("6 lines checked against their frames, 1 fixed.");
 * null before.
 * @param summary - The session.
 * @returns The note, or null.
 */
export function checkNote(summary: Pick<MemorySummary, 'status' | 'step' | 'moment_count' | 'fixed_count'>): string | null {
  const hasChecked = summary.status === 'ready' || (summary.status === 'making' && summary.step === 'cover');
  if (!hasChecked) return null;
  const lines = `${String(summary.moment_count)} ${summary.moment_count === 1 ? 'line' : 'lines'} checked against their frames`;
  return summary.fixed_count === 0 ? `${lines}; every line held.` : `${lines}, ${String(summary.fixed_count)} fixed.`;
}

/**
 * The end screen's headline ("That was Kristoff.").
 * @param summary - The session.
 * @returns The line.
 */
export const endLine = (summary: Pick<MemorySummary, 'subject_name'>): string => `That was ${summary.subject_name}.`;

/**
 * The end screen's body ("6 moments from 2 videos.").
 * @param detail - The session.
 * @returns The line.
 */
export function endBody(detail: MemoryDetail): string {
  const clips = new Set(detail.moments.map((moment) => moment.clip_id)).size;
  return `${momentCount(detail.moments.length)} from ${String(clips)} ${clips === 1 ? 'video' : 'videos'}. Watch it again any time.`;
}

/**
 * Where a moment plays in its clip, seconds; at least `MIN_WINDOW_S` long.
 * @param moment - The moment.
 * @returns Start and end.
 */
export function momentWindow(moment: Pick<MemoryMoment, 'start_s' | 'end_s'>): { start: number; end: number } {
  const start = Math.max(0, moment.start_s);
  return { start, end: Math.max(moment.end_s, start + MIN_WINDOW_S) };
}

/**
 * The progress words over the player ("60th birthday · 2 of 6").
 * @param moment - The moment shown.
 * @param at - Its place, 0-based.
 * @param count - How many.
 * @returns The words.
 */
export const progressLabel = (moment: Pick<MemoryMoment, 'clip_title'>, at: number, count: number): string =>
  `${moment.clip_title} · ${String(at + 1)} of ${String(count)}`;

/** The session player's state: the moment shown, how often it was (re)started, the names, the end. */
export interface SessionState {
  at: number;
  /** Goes up on every start of a moment (Again too), so the page replays it. */
  play: number;
  isRevealed: boolean;
  isEnded: boolean;
}

/** What the player can do. */
export type SessionAction = { type: 'next' } | { type: 'back' } | { type: 'again' } | { type: 'reveal' } | { type: 'restart' };

/** A session at its first moment. */
export const SESSION_START: SessionState = { at: 0, play: 0, isRevealed: false, isEnded: false };

/**
 * One player step. Next past the last moment ends the session; Back at the first stays; a new
 * moment hides the names again; Again replays the moment as it is.
 * @param count - How many moments.
 * @returns The reducer.
 */
export function sessionReducer(count: number): (state: SessionState, action: SessionAction) => SessionState {
  return (state, action) => {
    switch (action.type) {
      case 'next':
        if (state.isEnded) return state;
        return state.at + 1 >= count ? { ...state, isEnded: true } : { at: state.at + 1, play: state.play + 1, isRevealed: false, isEnded: false };
      case 'back':
        if (state.isEnded) return { ...state, isEnded: false, play: state.play + 1 };
        return state.at === 0 ? state : { at: state.at - 1, play: state.play + 1, isRevealed: false, isEnded: false };
      case 'again':
        return state.isEnded ? state : { ...state, play: state.play + 1 };
      case 'reveal':
        return state.isEnded ? state : { ...state, isRevealed: true };
      case 'restart':
        return { ...SESSION_START, play: state.play + 1 };
    }
  };
}

/**
 * The player's action for a key: ← back, → next, space again; null for any other key.
 * @param key - `KeyboardEvent.key`.
 * @returns The action, or null.
 */
export function keyAction(key: string): SessionAction | null {
  if (key === 'ArrowRight') return { type: 'next' };
  if (key === 'ArrowLeft') return { type: 'back' };
  if (key === ' ' || key === 'Spacebar') return { type: 'again' };
  return null;
}
