import { describe, expect, it } from 'vitest';
import listensJson from '../../test-support/fixtures/listens.json';
import { parseListen } from '../../services/api/parse-listens';
import type { ListenDetail } from '../../services/api/types';
import { heardLabel, languageBoth, languageLabel, OUTPUT_LANGUAGES } from './languages';
import {
  heardChips,
  listenFacts,
  listenFileProblem,
  listenPill,
  listenStageRows,
  listenSubLine,
  listenTitle,
  listenPanelLine,
  listenTitleProblem,
  listenType,
  loopLines,
  MAC_LISTEN_LIMIT,
  PWA_LISTEN_LIMIT,
  speakerSlots,
} from './listens';

const fixture = (id: string): ListenDetail => {
  const raw = listensJson.find((each) => each.id === id);
  const listen = parseListen(raw);
  if (listen === null) throw new Error(`listens.json ${id} does not parse`);
  return listen;
};

describe('languages', () => {
  it('names the twelve output languages in their own words, English first', () => {
    expect(OUTPUT_LANGUAGES.map((each) => each.label)).toEqual([
      'English', '中文', '日本語', '한국어', 'Tagalog', 'Español', 'Français', 'Deutsch', 'Bahasa Indonesia', 'Tiếng Việt', 'ไทย', 'हिन्दी',
    ]);
  });

  it('says a heard language with its share, and an unlisted code as it is', () => {
    expect(heardLabel({ code: 'zh', share: 60 })).toBe('中文 60%');
    expect(languageLabel('pt')).toBe('PT');
    expect(languageBoth('ja')).toBe('日本語 Japanese');
    expect(languageBoth('en')).toBe('English');
  });
});

describe('files', () => {
  it('takes audio and any video, reading a typeless file by its extension', () => {
    expect(listenType('a.mp3', 'audio/mpeg')).toBe('audio/mpeg');
    expect(listenType('clip.mov', 'video/quicktime')).toBe('video/quicktime');
    expect(listenType('memo.m4a', '')).toBe('audio/x-m4a');
    expect(listenType('memo.m4a', 'audio/m4a')).toBe('audio/x-m4a');
    expect(listenType('notes.pdf', 'application/pdf')).toBeNull();
  });

  it('says why a file cannot be listened to', () => {
    expect(listenFileProblem({ name: 'a.pdf', type: 'application/pdf', size: 1 }, PWA_LISTEN_LIMIT)).toContain('sound files');
    expect(listenFileProblem({ name: 'a.mp3', type: 'audio/mpeg', size: 0 }, PWA_LISTEN_LIMIT)).toBe('This file is empty.');
    expect(listenFileProblem({ name: 'a.mp3', type: 'audio/mpeg', size: 300 * 1024 * 1024 + 1 }, PWA_LISTEN_LIMIT)).toContain('300 MB');
    expect(listenFileProblem({ name: 'a.mp3', type: 'audio/mpeg', size: 300 * 1024 * 1024 }, PWA_LISTEN_LIMIT)).toBeNull();
  });

  it('keeps the Mac to 50 MB and points a longer recording at the library', () => {
    const mb = 1024 * 1024;
    expect(listenFileProblem({ name: 'a.mov', type: 'video/quicktime', size: 50 * mb }, MAC_LISTEN_LIMIT)).toBeNull();
    expect(listenFileProblem({ name: 'a.mov', type: 'video/quicktime', size: 50 * mb + 1 }, MAC_LISTEN_LIMIT)).toBe(
      'On the Mac, files up to 50 MB. For longer recordings, add the video to your library and press Listen on it.',
    );
  });
});

describe('rows', () => {
  it('shows the meeting as the mock does', () => {
    const meeting = fixture('lis_meeting');

    expect(heardChips(meeting)).toEqual(['中文 60%', '日本語 40%']);
    expect(listenFacts(meeting)).toBe('0:26 · 2 speakers');
    expect(listenSubLine(meeting)).toBe('mix.wav · 0:26 · 2 speakers');
    expect(listenPill(meeting)).toEqual({ label: 'Checked 100% · v2', tone: 'success' });
    expect(listenPill(meeting, true)).toEqual({ label: '100%', tone: 'success' });
    expect(listenPanelLine(meeting)).toBe('0:26 · 中文 60% · 日本語 40% → English');
    expect(listenPanelLine({ ...meeting, languages: [] })).toBe('0:26');
  });

  it('shows a first-try pass without the version, and a failed check as needing a human', () => {
    expect(listenPill(fixture('lis_birthday')).label).toBe('Checked 98%');
    expect(listenPill(fixture('lis_office'))).toEqual({ label: 'Needs a human check · 84%', tone: 'warning' });
  });

  it('shows a clip still listening by its name, its source and the version being checked', () => {
    const concert = fixture('lis_concert');

    expect(listenTitle(concert)).toBe('Concert stage performance');
    expect(listenPill(concert)).toEqual({ label: 'Checking v1…', tone: 'accent' });
    expect(listenFacts({ ...concert, languages: [] })).toBe('From your library · 3:12');
    expect(listenPill({ ...concert, step: 'transcribe' }).label).toBe('Transcribing…');
    expect(listenPill({ ...concert, status: 'uploading' }).label).toBe('Uploading…');
  });

  it('keeps a title to 1–80 characters', () => {
    expect(listenTitleProblem('  ')).toBe('Give the recording a title.');
    expect(listenTitleProblem('x'.repeat(81))).toBe('Use 80 characters or fewer.');
    expect(listenTitleProblem('Meeting')).toBeNull();
  });
});

describe('progress', () => {
  it('marks the steps before check done and check now, with what each found', () => {
    const rows = listenStageRows(fixture('lis_concert'));

    expect(rows.map((row) => [row.id, row.state])).toEqual([
      ['audio', 'done'],
      ['transcribe', 'done'],
      ['understand', 'done'],
      ['check', 'now'],
      ['cover', 'next'],
      ['voice', 'next'],
    ]);
    expect(rows[1]?.model).toBe('Meta Voice Transcribe · 3 speakers');
    expect(rows[2]?.model).toBe('Muse Spark · heard Tagalog 70%, English 30%');
    expect(rows[3]?.model).toBe('Muse Spark · version 1');
    expect(rows[4]).toMatchObject({ label: 'Cover', model: 'Drawing a cover' });
    expect(listenPill({ ...fixture('lis_concert'), step: 'cover' }).label).toBe('Drawing a cover…');
  });

  it('has every row done once ready, and Audio next while it uploads', () => {
    expect(listenStageRows(fixture('lis_meeting')).every((row) => row.state === 'done')).toBe(true);
    expect(listenStageRows({ ...fixture('lis_concert'), status: 'uploading', step: null })[0]?.state).toBe('now');
  });

  it('writes the loop: v1 fails with its note, the fix, then v2 being checked', () => {
    expect(
      loopLines([
        { version: 1, confidence: 75, summary_score: 75, passed: false, notes: ['Line 2: 11 AM should be 10 AM'] },
        { version: 2, confidence: null, summary_score: null, passed: false, notes: [] },
      ]),
    ).toEqual([
      { head: 'v1 · 75%', body: 'Line 2: 11 AM should be 10 AM' },
      { head: 'Fixing the flagged lines', body: 'the other lines stay as they are' },
      { head: 'v2 · checking…', body: 'pass is 90%, at most 3 versions' },
    ]);
    expect(loopLines(fixture('lis_meeting').versions).at(-1)).toEqual({ head: 'v2 · 100%', body: 'Passed' });
  });

  it('colours speakers in the order they first speak', () => {
    expect([...speakerSlots([{ speaker: 'B' }, { speaker: 'A' }, { speaker: null }, { speaker: 'B' }])]).toEqual([
      ['B', 0],
      ['A', 1],
    ]);
  });
});
