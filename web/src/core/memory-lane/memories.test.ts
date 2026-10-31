import { describe, expect, it } from 'vitest';
import type { MemoryDetail, MemorySummary } from '../../services/api/types';
import { checkNote, endBody, keyAction, makingTitle, memoryFacts, memoryStageRows, memoryTitle, momentWindow, SESSION_START, sessionReducer } from './memories';

const summary: MemorySummary = {
  id: 'mem_1',
  title: '',
  subject_kind: 'person',
  subject_name: 'Kristoff',
  viewer_name: 'Eric',
  status: 'making',
  step: 'write',
  moment_count: 6,
  fixed_count: 1,
  cover_url: null,
  created_at: '2026-10-31T09:00:00Z',
  error: null,
};

describe('making screen', () => {
  it('ticks the steps before the running one', () => {
    expect(memoryStageRows(summary).map((row) => row.state)).toEqual(['done', 'now', 'next', 'next']);
    expect(memoryStageRows({ status: 'ready', step: null }).every((row) => row.state === 'done')).toBe(true);
    expect(memoryStageRows({ status: 'making', step: null })[0]?.state).toBe('now');
  });

  it('titles a person session and a day', () => {
    expect(makingTitle(summary)).toBe('Making Kristoff’s memory session');
    expect(makingTitle({ subject_kind: 'clip', subject_name: '60th birthday' })).toBe('Making a memory session of 60th birthday');
  });

  it('shows the agent check only once the check ran, with the fixed count', () => {
    expect(checkNote(summary)).toBeNull();
    expect(checkNote({ ...summary, step: 'cover' })).toBe('6 lines checked against their frames, 1 fixed.');
    expect(checkNote({ ...summary, status: 'ready', step: null, fixed_count: 0 })).toBe('6 lines checked against their frames; every line held.');
  });
});

describe('list rows', () => {
  it('names a session by its title, else its subject', () => {
    expect(memoryTitle(summary)).toBe('Kristoff');
    expect(memoryTitle({ ...summary, title: 'Kristoff at the party' })).toBe('Kristoff at the party');
  });

  it('says who it is for and how far it is', () => {
    expect(memoryFacts({ ...summary, status: 'ready' })).toBe('For Eric · 6 moments');
    expect(memoryFacts({ ...summary, viewer_name: null })).toBe('Making…');
  });
});

describe('session player', () => {
  const step = sessionReducer(3);

  it('Next walks the moments, hides the names again and ends after the last', () => {
    let state = step(SESSION_START, { type: 'reveal' });
    expect(state.isRevealed).toBe(true);
    state = step(state, { type: 'next' });
    expect(state).toEqual({ at: 1, play: 1, isRevealed: false, isEnded: false });
    state = step(step(state, { type: 'next' }), { type: 'next' });
    expect(state).toMatchObject({ at: 2, isEnded: true });
    expect(step(state, { type: 'next' })).toBe(state);
  });

  it('Again replays the same moment and keeps the names shown', () => {
    const revealed = step(SESSION_START, { type: 'reveal' });
    expect(step(revealed, { type: 'again' })).toEqual({ at: 0, play: 1, isRevealed: true, isEnded: false });
  });

  it('Back stays at the first moment and leaves the end screen to the last moment', () => {
    expect(step(SESSION_START, { type: 'back' })).toBe(SESSION_START);
    const ended = { at: 2, play: 4, isRevealed: true, isEnded: true };
    expect(step(ended, { type: 'back' })).toEqual({ at: 2, play: 5, isRevealed: true, isEnded: false });
  });

  it('Watch again starts over from the first moment', () => {
    expect(step({ at: 2, play: 4, isRevealed: true, isEnded: true }, { type: 'restart' })).toEqual({ at: 0, play: 5, isRevealed: false, isEnded: false });
  });

  it('maps ←, → and space; other keys do nothing', () => {
    expect(keyAction('ArrowRight')).toEqual({ type: 'next' });
    expect(keyAction('ArrowLeft')).toEqual({ type: 'back' });
    expect(keyAction(' ')).toEqual({ type: 'again' });
    expect(keyAction('a')).toBeNull();
  });

  it('plays at least a second, never before 0', () => {
    expect(momentWindow({ start_s: 4, end_s: 9.5 })).toEqual({ start: 4, end: 9.5 });
    expect(momentWindow({ start_s: -1, end_s: 0 })).toEqual({ start: 0, end: 1 });
  });

  it('counts moments and videos at the end', () => {
    const moment = { index: 0, clip_id: 'c1', clip_title: 'Party', recorded_at: null, start_s: 0, end_s: 4, proxy_url: null, thumb_url: null, people: [], line: 'x', prompt: 'y', checked: true, fixed_note: null };
    const detail: MemoryDetail = { summary, moments: [moment, { ...moment, index: 1 }, { ...moment, index: 2, clip_id: 'c2' }] };
    expect(endBody(detail)).toBe('3 moments from 2 videos. Watch it again any time.');
  });
});
