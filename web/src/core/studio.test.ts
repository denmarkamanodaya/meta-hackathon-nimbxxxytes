import { describe, expect, it } from 'vitest';
import type { ShortDetail } from '../services/api/types';
import fixture from '../test-support/fixtures/short.json';
import { draftStepLabel, editorAtWorkLine, editorNote, inspectorLine, workingDraft } from './studio';

const detail = fixture as unknown as ShortDetail;

describe('workingDraft', () => {
  it('names what the editor does to which draft', () => {
    expect(workingDraft('planning', 0)).toEqual({ draft: 1, verb: 'Planning' });
    expect(workingDraft('rendering', 1)).toEqual({ draft: 1, verb: 'Rendering' });
    expect(workingDraft('critiquing', 2)).toEqual({ draft: 2, verb: 'Checking' });
    expect(workingDraft('revising', 2)).toEqual({ draft: 3, verb: 'Revising' });
  });

  it('never counts past the last draft, and is null once the short is done or stopped', () => {
    expect(workingDraft('revising', 3)).toEqual({ draft: 3, verb: 'Revising' });
    expect(workingDraft('ready', 3)).toBeNull();
    expect(workingDraft('failed', 1)).toBeNull();
  });
});

describe('draftStepLabel and editorAtWorkLine', () => {
  it('says the draft out of three, on the tile and in the phone card', () => {
    const working = { draft: 2, verb: 'Checking' };

    expect(draftStepLabel(working)).toBe('Checking draft 2 of 3');
    expect(editorAtWorkLine(working)).toBe('Editor is checking draft 2 of 3');
  });
});

describe('inspectorLine', () => {
  it('counts drafts, the moments in the shown cut and the clips they come from', () => {
    const shown = detail.versions[2];
    if (shown === undefined) throw new Error('fixture has three drafts');

    expect(inspectorLine(detail, shown)).toBe('3 drafts · from 4 moments in 3 clips');
  });

  it('says only the drafts when the cut has no shots', () => {
    const shown = detail.versions[0];
    if (shown === undefined) throw new Error('fixture has a first draft');

    expect(inspectorLine({ ...detail, versions: [shown] }, { ...shown, timeline: { ...shown.timeline, clips: [] } })).toBe('1 draft');
  });
});

describe('editorNote', () => {
  it('says what a revision fixed, else the reasoning of the first cut', () => {
    const [first, , third] = detail.versions;
    if (first === undefined || third === undefined) throw new Error('fixture has three drafts');

    expect(editorNote(third)).toBe('Draft 3: The desk shot ended on a blank screen');
    expect(editorNote(first)).toBe('Open on the latte pour for the hook, walk the street for pace, end at the desk.');
  });
});
